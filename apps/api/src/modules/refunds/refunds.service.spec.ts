import {
  assertPaymentApprovalPermission,
  getPaymentApprovalPermissions,
} from '../payments/services/payment-approval-permissions';
jest.mock('../payments/services/payment-approval-permissions', () => ({
  ...jest.requireActual('../payments/services/payment-approval-permissions'),
  assertPaymentApprovalPermission: jest.fn(),
  getPaymentApprovalPermissions: jest.fn(),
}));
jest.mock('../../utils/period-lock.util', () => ({ validatePeriodOpen: jest.fn() }));

import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE } from '../journal/advance-excess-income.util';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RECEIPT_NOT_ISSUED_REFUND_MESSAGE, RefundsService } from './refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { validatePeriodOpen } from '../../utils/period-lock.util';

describe('RefundsService', () => {
  let service: RefundsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let template: any;

  const paidPayment = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    contractId: 'con-1',
    amountPaid: new Prisma.Decimal(1000),
    status: 'PAID',
    // ยังไม่ถึงวันครบกำหนด — คืนเงินที่ไม่เหลือยอดได้ PENDING (เลยกำหนด = OVERDUE · เคสของตัวเองข้างล่าง)
    dueDate: new Date('2099-01-05T00:00:00+07:00'),
    legacyInstallmentCode: null,
    deletedAt: null,
    refunds: [],
    ...overrides,
  });
  /** รายการรับชำระ POSTED ที่ผูก paymentId และยังไม่ถูกกลับ — มีให้กลับรายการ (ทุก query ของ journalEntry ใช้ชุดเดียว) */
  const receiptEntry = {
    id: 'je-receipt',
    companyId: 'co-finance',
    metadata: { tag: 'receipt', paymentId: 'pay-1' },
    lines: [],
  };
  const noRefundableMoney = /ไม่มีใบเสร็จ\/รายการรับชำระในระบบนี้ให้คืน/;

  const refundRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'rf-1',
    paymentId: 'pay-1',
    contractId: 'con-1',
    amount: new Prisma.Decimal(500),
    reason: 'customer double-paid',
    status: 'REQUESTED',
    requestedById: 'u-staff',
    requestedAt: new Date(),
    approvedById: null,
    approvedAt: null,
    rejectedById: null,
    rejectedAt: null,
    deletedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    const actor = {
      user: { id: 'u-fm', name: 'Finance', role: 'FINANCE_MANAGER', branchId: 'branch-a' },
      permissions: ['REFUND'],
    };
    (assertPaymentApprovalPermission as jest.Mock).mockReset().mockResolvedValue(actor);
    (getPaymentApprovalPermissions as jest.Mock).mockReset().mockResolvedValue(actor);
    prisma = {
      contract: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch-a' }) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ role: 'FINANCE_MANAGER', isActive: true, deletedAt: null }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      payment: {
        findUnique: jest.fn().mockResolvedValue(paidPayment()),
        update: jest.fn().mockResolvedValue({}),
      },
      // PR-843/I2 Phase 3 PR 3.1: markReversed now finds ALL receipt JEs of the payment
      // via metadata.paymentId (findMany) and reverses EACH — not a single findFirst.
      journalEntry: { findMany: jest.fn().mockResolvedValue([receiptEntry]) },
      // Task 17 A: markReversed คืนแถวงวดจากยอดในบัญชี (revertPaymentFromLedger) — ไม่มีแถวตารางงวด = ไม่เหลือยอด
      installmentSchedule: { findUnique: jest.fn().mockResolvedValue(null) },
      // Task 18 R-2: ยอดคืน = ใบเสร็จค่างวดที่ยังมีผลเท่านั้น (ไม่มีใบ = ปฏิเสธ ไม่ถอยไป amountPaid) — ค่าเริ่มต้นคือใบเดียวที่ยอด
      // เท่า amountPaid ของแถวที่ mock ไว้ (= สภาพของงวดที่รับเงินด้วยใบเสร็จตามปกติ) · ออกก่อนคำขอเสมอ · เคสไม่มีใบ/ใบถูกยกเลิก
      // ตั้งเองในเทสต์ของตัวเอง
      receipt: {
        findMany: jest.fn(async () => {
          const row = await prisma.payment.findUnique();
          return row
            ? [
                {
                  amount: new Prisma.Decimal(row.amountPaid),
                  isVoided: false,
                  deletedAt: null,
                  createdAt: new Date(0),
                },
              ]
            : [];
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      refund: {
        create: jest.fn((args) => Promise.resolve({ id: 'rf-1', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ ...refundRecord(), ...args.data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), // CAS: APPROVED → PROCESSED
        findUnique: jest.fn().mockResolvedValue(refundRecord()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    // $transaction runs the callback against the same mock (tx === prisma here).
    prisma.$transaction = jest
      .fn()
      .mockImplementation(async (cb: (t: typeof prisma) => unknown) => cb(prisma));
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    template = { voidReceipt: jest.fn().mockResolvedValue({ entryNo: 'JE-REV-1' }) };
    (validatePeriodOpen as jest.Mock).mockReset().mockResolvedValue(undefined);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ReceiptVoidReversalTemplate, useValue: template },
      ],
    }).compile();
    service = mod.get(RefundsService);
  });

  describe('requestRefund', () => {
    it('rejects a partial refund (amount < amountPaid) — full refunds only', async () => {
      // paidPayment amountPaid = 1000; a 500 request is partial → rejected up front.
      await expect(
        service.requestRefund(
          { paymentId: 'pay-1', amount: 500, reason: 'partial xxxxxxxx' },
          'u-staff',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('creates REQUESTED refund + writes audit', async () => {
      const result = await service.requestRefund(
        { paymentId: 'pay-1', amount: 1000, reason: 'customer double-paid ชำระซ้ำ' }, // full = amountPaid
        'u-staff',
      );
      expect(result.id).toBe('rf-1');
      expect(prisma.refund.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'REFUND_REQUESTED', entity: 'Refund' }),
        }),
      );
    });

    it('throws NotFound when payment missing', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await expect(
        service.requestRefund(
          { paymentId: 'missing', amount: 500, reason: 'xxxxxxxxxx' },
          'u-staff',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when payment is PENDING (not paid)', async () => {
      prisma.payment.findUnique.mockResolvedValue(paidPayment({ status: 'PENDING' }));
      await expect(
        service.requestRefund({ paymentId: 'pay-1', amount: 500, reason: 'xxxxxxxxxx' }, 'u-staff'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when open refund already exists (REQUESTED/APPROVED)', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ refunds: [refundRecord({ status: 'REQUESTED' })] }),
      );
      await expect(
        service.requestRefund({ paymentId: 'pay-1', amount: 500, reason: 'xxxxxxxxxx' }, 'u-staff'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Task 17 A — an imported legacy installment with no receipt in this system: refundable 0, Thai 400, no request', async () => {
      // สภาพจริงของงวดนำเข้าก่อนวันตัด: ไม่มีแถวใบเสร็จ (ตัวนำเข้าสร้างแค่หลักฐาน) และไม่มีรายการผูก paymentId (marker ผูกแค่
      // installmentScheduleId) — งวดนำเข้าที่มีรายการหลังวันตัดแต่ใบออกไม่สำเร็จ = เคส R-2 (ออกใบซ้ำ)
      prisma.receipt.findMany.mockResolvedValue([]);
      prisma.journalEntry.findMany.mockResolvedValue([]);
      for (const status of ['PAID', 'PARTIALLY_PAID']) {
        prisma.payment.findUnique.mockResolvedValue(
          paidPayment({
            status,
            legacyInstallmentCode: 'LEG-INST-1',
            amountPaid: new Prisma.Decimal(1000),
          }),
        );
        await expect(
          service.requestRefund(
            { paymentId: 'pay-1', amount: 1000, reason: 'customer double-paid ชำระซ้ำ' },
            'u-staff',
          ),
        ).rejects.toThrow(noRefundableMoney);
      }
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('Task 17 I-1 — any installment with no receipt AND no live receipt JE (paid by advance consume / a contract-level entry): refundable 0, Thai 400', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ status: 'PARTIALLY_PAID', amountPaid: new Prisma.Decimal(500) }),
      );
      // รายการที่ผูก paymentId มีแต่ต้นฉบับที่ถูกกลับแล้ว (ยกเลิกใบเสร็จไปก่อน) หรือไม่มีเลย — ไม่มีอะไรให้กลับรายการ
      for (const entries of [
        [],
        [{ ...receiptEntry, metadata: { tag: 'receipt', reversed: true } }],
      ]) {
        prisma.journalEntry.findMany.mockResolvedValue(entries);
        await expect(
          service.requestRefund(
            { paymentId: 'pay-1', amount: 500, reason: 'customer double-paid ชำระซ้ำ' },
            'u-staff',
          ),
        ).rejects.toThrow(noRefundableMoney);
      }
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('Task 18 R-1 — a live receipt but no live receipt JE bound to the payment: refused at request (not only after the bank call)', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      );
      prisma.receipt.findMany.mockResolvedValue([
        {
          amount: new Prisma.Decimal(500),
          isVoided: false,
          deletedAt: null,
          createdAt: new Date(),
        },
      ]);
      // รายการรับชำระของงวดไม่มี (เช่น ถูก JournalService.void เป็น VOIDED) หรือถูกกลับหมดแล้วโดยใบเสร็จยังไม่ถูกยกเลิก
      for (const entries of [
        [],
        [{ ...receiptEntry, metadata: { tag: 'receipt', paymentId: 'pay-1', reversed: true } }],
      ]) {
        prisma.journalEntry.findMany.mockResolvedValue(entries);
        await expect(
          service.requestRefund(
            { paymentId: 'pay-1', amount: 500, reason: 'customer double-paid ชำระซ้ำ' },
            'u-staff',
          ),
        ).rejects.toThrow(noRefundableMoney);
      }
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('Task 18 R-2 — no receipt row but a live receipt JE (receipt issue failed after commit / a pre-receipt row): never falls back to amountPaid — refused with the re-issue message', async () => {
      prisma.receipt.findMany.mockResolvedValue([]);
      // งวดปกติ (amountPaid 1,515.83 = ใบรับชำระ 1,015.83 + รอบกลางคืนหักเงินรับล่วงหน้า 500 ไม่มี paymentId) และงวดนำเข้าที่ใบหลัง
      // วันตัดออกไม่สำเร็จ (amountPaid รวมยอดก่อนวันตัด 300) — เดิมคืน amountPaid ทั้งก้อน ซึ่งเกินเงินของรายการที่จะถูกกลับ
      for (const legacyInstallmentCode of [null, 'LEG-INST-1']) {
        prisma.payment.findUnique.mockResolvedValue(
          paidPayment({ legacyInstallmentCode, amountPaid: new Prisma.Decimal('1515.83') }),
        );
        for (const amount of [1515.83, 1015.83]) {
          await expect(
            service.requestRefund(
              { paymentId: 'pay-1', amount, reason: 'customer double-paid ชำระซ้ำ' },
              'u-staff',
            ),
          ).rejects.toThrow(RECEIPT_NOT_ISSUED_REFUND_MESSAGE);
        }
      }
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('Task 18 m-1 — the re-issue message points to what staff can do today (tell accounting; no button yet), not to an admin role or a rules file', () => {
      expect(RECEIPT_NOT_ISSUED_REFUND_MESSAGE).toContain('แจ้งฝ่ายบัญชี');
      expect(RECEIPT_NOT_ISSUED_REFUND_MESSAGE).toContain('ยังไม่มีปุ่มในระบบ');
      expect(RECEIPT_NOT_ISSUED_REFUND_MESSAGE).not.toMatch(/ผู้ดูแลระบบ|ออกใบเสร็จซ้ำ|\.claude/);
    });

    it('Task 17 A — a legacy installment WITH a receipt after cutover refunds only that receipt (not the pre-cutover money)', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({
          legacyInstallmentCode: 'LEG-INST-1',
          amountPaid: new Prisma.Decimal('1515.83'),
        }),
      );
      prisma.receipt.findMany.mockResolvedValue([
        {
          amount: new Prisma.Decimal('1215.83'),
          isVoided: false,
          deletedAt: null,
          createdAt: new Date(),
        },
      ]);
      await expect(
        service.requestRefund(
          { paymentId: 'pay-1', amount: 1515.83, reason: 'customer double-paid ชำระซ้ำ' },
          'u-staff',
        ),
      ).rejects.toThrow(BadRequestException);
      await service.requestRefund(
        { paymentId: 'pay-1', amount: 1215.83, reason: 'customer double-paid ชำระซ้ำ' },
        'u-staff',
      );
      expect(prisma.refund.create).toHaveBeenCalledTimes(1);
    });

    // Task 18 M-3: คืนเงินที่ PROCESSED แล้วยกเลิกใบเสร็จของงวดทุกใบ (markReversed `receipt.updateMany`) และกลับรายการรับชำระ
    // (ต้นฉบับ `reversed: true`) — ยอดคืนได้ (ใบที่ยังมีผล) จึงไม่รวมเงินก้อนที่คืนไปแล้วอยู่แล้ว · การหัก Σ คืนเงิน PROCESSED ซ้ำอีกที
    // ทำให้คืนเงินรอบสองหลังรับเงินใหม่ได้ 400 เสมอ
    const firstCycle = {
      payment: () =>
        paidPayment({
          amountPaid: new Prisma.Decimal('1515.83'),
          refunds: [refundRecord({ status: 'PROCESSED', amount: new Prisma.Decimal('1515.83') })],
        }),
      voidedReceipt: {
        amount: new Prisma.Decimal('1515.83'),
        isVoided: true,
        deletedAt: null,
        createdAt: new Date('2025-05-02T10:00:00+07:00'),
      },
      reversedEntry: {
        ...receiptEntry,
        id: 'je-receipt-1',
        metadata: { tag: 'receipt', paymentId: 'pay-1', reversed: true },
      },
    };

    it('Task 18 M-3 — pay → refund → pay again → refund again: the second refund is the new receipt in full', async () => {
      prisma.payment.findUnique.mockResolvedValue(firstCycle.payment());
      prisma.receipt.findMany.mockResolvedValue([
        firstCycle.voidedReceipt,
        {
          amount: new Prisma.Decimal('1515.83'),
          isVoided: false,
          deletedAt: null,
          createdAt: new Date('2025-05-03T10:00:00+07:00'),
        },
      ]);
      prisma.journalEntry.findMany.mockResolvedValue([
        firstCycle.reversedEntry,
        { ...receiptEntry, id: 'je-receipt-2' },
      ]);
      const refund = await service.requestRefund(
        { paymentId: 'pay-1', amount: 1515.83, reason: 'ลูกค้าโอนซ้ำรอบที่สอง' },
        'u-staff',
      );
      expect(refund.status).toBe('REQUESTED');
      expect(prisma.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: new Prisma.Decimal('1515.83') }),
        }),
      );
    });

    it('Task 18 M-3 — the money of a PROCESSED refund cannot be refunded again (its receipts are voided, its JE reversed)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...firstCycle.payment(),
        status: 'PARTIALLY_PAID',
        amountPaid: new Prisma.Decimal(300), // ยอดที่ล้างงวดโดยไม่มีใบเสร็จคงอยู่ (marker งวดนำเข้า)
      });
      prisma.receipt.findMany.mockResolvedValue([firstCycle.voidedReceipt]);
      prisma.journalEntry.findMany.mockResolvedValue([firstCycle.reversedEntry]);
      for (const amount of [1515.83, 300]) {
        await expect(
          service.requestRefund({ paymentId: 'pay-1', amount, reason: 'xxxxxxxxxx' }, 'u-staff'),
        ).rejects.toThrow(noRefundableMoney);
      }
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });
  });

  describe('ด่าน PR4 ต6ข — สัญญาที่ลงรายได้เงินพักส่วนเกิน (42-1106) แล้ว (final review I3: ทางคืนเงินต้องติดด่านเดียวกับยกเลิกใบเสร็จ)', () => {
    const activeSweep = [
      {
        id: 'je-aei',
        entryNumber: 'JE-AEI-0001',
        metadata: { flow: 'advance-excess-income', tag: 'ADVANCE_EXCESS', contractId: 'con-1' },
      },
    ];

    it('requestRefund ปฏิเสธด้วยข้อความด่านเดียวกัน — ไม่สร้างคำขอ', async () => {
      prisma.journalEntry.findMany.mockResolvedValue(activeSweep);
      await expect(
        service.requestRefund(
          { paymentId: 'pay-1', amount: 1000, reason: 'customer double-paid ชำระซ้ำ' },
          'u-staff',
        ),
      ).rejects.toThrow(ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('markReversed ปฏิเสธก่อนแตะอะไร — ไม่กลับรายการ ไม่คืนงวดเป็นค้าง ไม่ flip PROCESSED', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      );
      prisma.journalEntry.findMany.mockResolvedValue(activeSweep);
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'KBANK-12345', notes: 'confirmed phone call' },
          'u-fm',
          'FINANCE_MANAGER',
        ),
      ).rejects.toThrow(ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE);
      expect(template.voidReceipt).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('approveRefund', () => {
    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      );
    });
    it('blocks self-approval', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ requestedById: 'u-same' }));
      await expect(service.approveRefund('rf-1', 'u-same', 'OWNER')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('blocks an actor without a REFUND permission grant', async () => {
      (assertPaymentApprovalPermission as jest.Mock).mockRejectedValueOnce(
        new ForbiddenException('not granted'),
      );
      await expect(service.approveRefund('rf-1', 'u-other', 'BRANCH_MANAGER')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Task 17 A — a request left on a legacy installment without receipts cannot be approved (same Thai 400)', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ legacyInstallmentCode: 'LEG-INST-1', amountPaid: new Prisma.Decimal(500) }),
      );
      // งวดนำเข้าก่อนวันตัด: ไม่มีใบเสร็จและไม่มีรายการผูก paymentId (ดูเคสขอคืนข้างบน)
      prisma.receipt.findMany.mockResolvedValue([]);
      prisma.journalEntry.findMany.mockResolvedValue([]);
      await expect(service.approveRefund('rf-1', 'u-owner', 'OWNER')).rejects.toThrow(
        noRefundableMoney,
      );
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });

    it('Task 18 R-2 — a request on an installment whose receipt was never issued cannot be approved (re-issue message)', async () => {
      prisma.receipt.findMany.mockResolvedValue([]);
      await expect(service.approveRefund('rf-1', 'u-owner', 'OWNER')).rejects.toThrow(
        RECEIPT_NOT_ISSUED_REFUND_MESSAGE,
      );
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });

    it('Task 18 R-1 — a request whose receipt JE stopped being live cannot be approved (same Thai 400, before staff calls the bank)', async () => {
      prisma.receipt.findMany.mockResolvedValue([
        {
          amount: new Prisma.Decimal(500),
          isVoided: false,
          deletedAt: null,
          createdAt: new Date(0),
        },
      ]);
      prisma.journalEntry.findMany.mockResolvedValue([]);
      await expect(service.approveRefund('rf-1', 'u-owner', 'OWNER')).rejects.toThrow(
        noRefundableMoney,
      );
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });

    it('rejects non-REQUESTED status', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      await expect(service.approveRefund('rf-1', 'u-fm', 'FINANCE_MANAGER')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('authorized actor approves using CAS and audit in the same transaction', async () => {
      await service.approveRefund('rf-1', 'u-owner', 'OWNER');
      expect(assertPaymentApprovalPermission).toHaveBeenCalledWith(prisma, 'u-owner', 'REFUND');
      expect(prisma.refund.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rf-1', status: 'REQUESTED', deletedAt: null },
          data: expect.objectContaining({ status: 'APPROVED', approvedById: 'u-owner' }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'REFUND_APPROVED' }) }),
      );
    });
  });

  describe('rejectRefund', () => {
    it('rejects self-rejection', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ requestedById: 'u-same' }));
      await expect(
        service.rejectRefund('rf-1', { reason: 'no basis' }, 'u-same', 'OWNER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates status REJECTED + stores reason', async () => {
      await service.rejectRefund(
        'rf-1',
        { reason: 'insufficient evidence' },
        'u-fm',
        'FINANCE_MANAGER',
      );
      const data = prisma.refund.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('REJECTED');
      expect(data.rejectedReason).toBe('insufficient evidence');
    });
  });

  describe('markReversed', () => {
    it('requires APPROVED status', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'REQUESTED' }));
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'KBANK-12345', notes: 'confirmed by phone' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets PROCESSED with bank ref + audit', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      ); // = refund.amount (full)
      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'KBANK-12345', notes: 'confirmed phone call' },
        'u-fm',
        'FINANCE_MANAGER',
      );
      const data = prisma.refund.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('PROCESSED');
      expect(data.bankReversalRef).toBe('KBANK-12345');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'REFUND_PROCESSED' }) }),
      );
    });

    it('rejects a partial refund (amount ≠ amountPaid) — full refunds only', async () => {
      prisma.refund.findUnique.mockResolvedValue(
        refundRecord({ status: 'APPROVED', amount: new Prisma.Decimal(500) }),
      );
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(1000) }),
      ); // 500 ≠ 1000
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'KBANK-x', notes: 'partial' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('markReversed — ledger reversal', () => {
    it('reverses ALL receipt JEs of the payment (metadata.paymentId, flow refund-reversal), reverts the payment + voids its receipt', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      ); // = refund.amount
      // PR-843/I2 Phase 3 PR 3.1: the epic posts MULTIPLE receipt JEs per Payment (a
      // partial then a completion), all sharing metadata.paymentId. Refunds are always
      // full (owner-confirmed #1164), so EVERY receipt JE must be reversed — return TWO.
      prisma.journalEntry.findMany.mockResolvedValue([
        { id: 'je-1', companyId: 'co-finance', lines: [] },
        { id: 'je-2', companyId: 'co-finance', lines: [] },
      ]);
      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'KBANK-1', notes: 'rev' },
        'u-owner',
        'OWNER',
      );

      // The canonical payment→JE link is metadata.paymentId (each receipt JE now carries
      // a unique reference, so the old referenceId == paymentId findFirst found at most
      // one). Asserting the JSON path catches a regression back to the single-JE lookup.
      //
      // FINAL-REVIEW BLOCKER 2: the WHERE now AND-combines the paymentId match with a
      // tag OR-filter (receipt / 2B / credit-allocation) + status POSTED + deletedAt
      // null, so the overpayment-credit JE (same paymentId, tag:'overpayment-credit')
      // is excluded from the reversal at the DB.
      expect(prisma.journalEntry.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            { metadata: { path: ['paymentId'], equals: 'pay-1' } },
            {
              OR: [
                { metadata: { path: ['tag'], equals: 'receipt' } },
                { metadata: { path: ['tag'], equals: '2B' } },
                { metadata: { path: ['tag'], equals: 'credit-allocation' } },
              ],
            },
            { status: 'POSTED' },
            { deletedAt: null },
          ],
        },
      });
      // Reverse EACH — reversing only one would leave the other receipt's Cr 11-2103
      // un-reversed (partial reversal of a full refund = ledger defect).
      expect(template.voidReceipt).toHaveBeenCalledTimes(2);
      expect(template.voidReceipt).toHaveBeenCalledWith('je-1', prisma, {
        flow: 'refund-reversal',
      });
      expect(template.voidReceipt).toHaveBeenCalledWith('je-2', prisma, {
        flow: 'refund-reversal',
      });
      // Period guard uses the first found entry's companyId (all share FINANCE).
      expect(validatePeriodOpen).toHaveBeenCalledWith(prisma, expect.any(Date), 'co-finance');
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'PENDING', amountPaid: 0, paidDate: null },
      });
      expect(prisma.receipt.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'pay-1', isVoided: false, deletedAt: null },
        data: expect.objectContaining({ isVoided: true, voidApprovedById: 'u-owner' }),
      });
      const data = prisma.refund.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('PROCESSED');
    });

    it('does NOT reverse the overpayment-credit JE — only the receivable-clearing receipt JE (FINAL-REVIEW BLOCKER 2)', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      );
      // The payment has TWO JEs sharing metadata.paymentId='pay-1': the receivable-
      // clearing receipt JE (tag:'receipt') AND the overpayment-credit JE
      // (tag:'overpayment-credit', Dr cash / Cr 21-5101). The tag OR-filter in the
      // WHERE means the DB returns ONLY the receipt JE — model that here.
      prisma.journalEntry.findMany.mockResolvedValue([
        { id: 'je-receipt', companyId: 'co-finance', lines: [] },
      ]);

      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'KBANK-1', notes: 'rev' },
        'u-owner',
        'OWNER',
      );

      // Only the receipt JE is reversed — the overpayment-credit JE is never touched.
      expect(template.voidReceipt).toHaveBeenCalledTimes(1);
      expect(template.voidReceipt).toHaveBeenCalledWith('je-receipt', prisma, {
        flow: 'refund-reversal',
      });
      expect(template.voidReceipt).not.toHaveBeenCalledWith('je-overpay', prisma, {
        flow: 'refund-reversal',
      });

      // The WHERE's tag OR-filter must NOT include 'overpayment-credit' — that is the
      // exact exclusion that protects the customer credit balance from a phantom reversal.
      // PR4 ต6ข: findMany ครั้งแรกเป็นด่าน assertNoAdvanceExcessIncome — query ใบรับชำระคือครั้งสุดท้าย
      const whereArg = prisma.journalEntry.findMany.mock.calls.at(-1)[0].where;
      const orClause = whereArg.AND.find((c: { OR?: unknown }) => Array.isArray(c.OR))?.OR ?? [];
      const tags = orClause.map((c: { metadata?: { equals?: unknown } }) => c.metadata?.equals);
      expect(tags).toEqual(expect.arrayContaining(['receipt', '2B', 'credit-allocation']));
      expect(tags).not.toContain('overpayment-credit');
    });

    it('Task 17 I-1 — no POSTED receipt JE to reverse (even with a receipt row): refuses before anything is written — money must not leave without a ledger entry', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      );
      // ใบเสร็จ 500 มี (ยอดคืนได้ผ่าน) แต่รายการรับชำระของงวดไม่มี/ถูกกลับหมด — ด่านสำรองใน markReversed
      prisma.receipt.findMany.mockResolvedValue([
        {
          amount: new Prisma.Decimal(500),
          isVoided: false,
          deletedAt: null,
          createdAt: new Date('2025-05-02T10:00:00+07:00'),
        },
      ]);
      prisma.journalEntry.findMany.mockResolvedValue([]);
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'KBANK-2', notes: 'rev' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(noRefundableMoney);
      expect(template.voidReceipt).not.toHaveBeenCalled();
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.receipt.updateMany).not.toHaveBeenCalled();
    });

    it('Task 17 A — bank confirmation of a request left on a legacy installment without receipts is refused (same Thai 400)', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ legacyInstallmentCode: 'LEG-INST-1', amountPaid: new Prisma.Decimal(500) }),
      );
      // งวดนำเข้าก่อนวันตัด: ไม่มีใบเสร็จและไม่มีรายการผูก paymentId
      prisma.receipt.findMany.mockResolvedValue([]);
      prisma.journalEntry.findMany.mockResolvedValue([]);
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'KBANK-11', notes: 'rev' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(noRefundableMoney);
      expect(template.voidReceipt).not.toHaveBeenCalled();
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('Task 18 R-2 — bank confirmation of a request on an installment without a receipt row is refused before anything is written (re-issue message)', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      );
      prisma.receipt.findMany.mockResolvedValue([]);
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'KBANK-12', notes: 'rev' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(RECEIPT_NOT_ISSUED_REFUND_MESSAGE);
      expect(template.voidReceipt).not.toHaveBeenCalled();
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('Task 17 A — money that cleared the installment without a receipt (marker / advance consume) survives: PARTIALLY_PAID from the ledger, not 0', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({
          amountPaid: new Prisma.Decimal(800),
          amountDue: new Prisma.Decimal('1515.83'),
          installmentNo: 4,
          dueDate: new Date('2025-04-05T00:00:00+07:00'),
        }),
      );
      // ใบเสร็จหลังวันตัด 500 (= ยอดคืน) · ยอดอีก 300 มาจากรายการที่ไม่มี paymentId (marker ของงวดนำเข้า)
      prisma.receipt.findMany.mockResolvedValue([
        {
          amount: new Prisma.Decimal(500),
          isVoided: false,
          deletedAt: null,
          createdAt: new Date('2025-05-02T10:00:00+07:00'),
        },
      ]);
      prisma.installmentSchedule.findUnique.mockResolvedValue({ id: 'sch-4' });
      const marker = {
        id: 'je-marker',
        metadata: { tag: '2B', flow: 'legacy-prior-receipt', installmentScheduleId: 'sch-4' },
        lines: [
          { accountCode: '32-1101', debit: new Prisma.Decimal(300), credit: new Prisma.Decimal(0) },
          { accountCode: '11-2103', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(300) },
        ],
      };
      prisma.journalEntry.findMany.mockImplementation(async (args: unknown) => {
        const text = JSON.stringify(args);
        if (text.includes('installmentScheduleId')) return [marker]; // reconstructPriorCleared
        if (text.includes('"paymentId"'))
          return [{ id: 'je-receipt', companyId: 'co-finance', lines: [] }];
        return [];
      });

      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'KBANK-9', notes: 'rev' },
        'u-owner',
        'OWNER',
      );

      expect(template.voidReceipt).toHaveBeenCalledWith('je-receipt', prisma, {
        flow: 'refund-reversal',
      });
      expect(prisma.installmentSchedule.findUnique).toHaveBeenCalledWith({
        where: { contractId_installmentNo: { contractId: 'con-1', installmentNo: 4 } },
        select: { id: true },
      });
      const [update] = prisma.payment.update.mock.calls.map((c: unknown[]) => c[0]);
      expect(update.where).toEqual({ id: 'pay-1' });
      expect([update.data.status, update.data.amountPaid.toFixed(2), update.data.paidDate]).toEqual(
        ['PARTIALLY_PAID', '300.00', null],
      );
      const audit = prisma.auditLog.create.mock.calls
        .map((c: unknown[]) => (c[0] as { data: { action: string; newValue: unknown } }).data)
        .find((d: { action: string }) => d.action === 'REFUND_PROCESSED');
      expect(audit.newValue).toMatchObject({
        paymentReverted: {
          fromStatus: 'PAID',
          toStatus: 'PARTIALLY_PAID',
          previousAmountPaid: '800',
          survivingAmountPaid: '300',
        },
      });
    });

    it('Task 17 A — nothing survives on a past-due installment → OVERDUE with amountPaid 0 (same rule as receipt void)', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({
          amountPaid: new Prisma.Decimal(500),
          amountDue: new Prisma.Decimal(500),
          installmentNo: 2,
          dueDate: new Date('2025-02-05T00:00:00+07:00'),
        }),
      );
      prisma.installmentSchedule.findUnique.mockResolvedValue({ id: 'sch-2' });
      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'KBANK-10', notes: 'rev' },
        'u-owner',
        'OWNER',
      );
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'OVERDUE', amountPaid: 0, paidDate: null },
      });
    });

    it('closed period: throws and reverts nothing', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      );
      (validatePeriodOpen as jest.Mock).mockRejectedValue(new Error('period closed'));
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'KBANK-3', notes: 'rev' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow('period closed');
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  // T1-C8 — bankReversalRef / bankReversalAt are write-once. First write
  // sets bankReversalLockedAt; any subsequent markReversed attempt must
  // reject with a Thai error.
  describe('markReversed — T1-C8 bank reversal lock', () => {
    it('first write sets bankReversalLockedAt', async () => {
      prisma.refund.findUnique.mockResolvedValue(
        refundRecord({ status: 'APPROVED', bankReversalLockedAt: null, bankReversalRef: null }),
      );
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ amountPaid: new Prisma.Decimal(500) }),
      ); // = refund.amount (full)
      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'SCB-00001', notes: 'first write' },
        'u-owner',
        'OWNER',
      );
      const data = prisma.refund.updateMany.mock.calls[0][0].data;
      expect(data.bankReversalRef).toBe('SCB-00001');
      expect(data.bankReversalLockedAt).toBeInstanceOf(Date);
    });

    it('rejects a second write once bankReversalLockedAt is set', async () => {
      prisma.refund.findUnique.mockResolvedValue(
        refundRecord({
          status: 'APPROVED',
          bankReversalRef: 'SCB-00001',
          bankReversalAt: new Date('2026-04-01'),
          bankReversalLockedAt: new Date('2026-04-01'),
        }),
      );
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'SCB-99999', notes: 'try to overwrite' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(/ถูกล็อคแล้ว/);
      expect(prisma.refund.update).not.toHaveBeenCalled();
    });

    it('reading still works after lock is set (findOne)', async () => {
      const frozen = refundRecord({
        status: 'PROCESSED',
        bankReversalRef: 'SCB-00001',
        bankReversalAt: new Date('2026-04-01'),
        bankReversalLockedAt: new Date('2026-04-01'),
      });
      prisma.refund.findUnique.mockResolvedValue(frozen);
      const result = await service.findOne('rf-1', 'u-fm');
      expect(result.bankReversalRef).toBe('SCB-00001');
      expect(result.bankReversalLockedAt).toBeInstanceOf(Date);
    });
  });

  describe('markFailed', () => {
    it('sets FAILED with reason when bank declined', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      await service.markFailed(
        'rf-1',
        { failureReason: 'bank refused reversal after 7 days' },
        'u-owner',
        'OWNER',
      );
      const data = prisma.refund.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('FAILED');
      expect(data.failureReason).toContain('bank refused');
    });
  });
});

import { consumePaymentApproval } from '../../payments/services/payment-approval-request.util';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptNumberService } from './receipt-number.service';
import { ReceiptVoidService } from './receipt-void.service';

jest.mock('../../payments/services/payment-approval-request.util', () => ({
  ...jest.requireActual('../../payments/services/payment-approval-request.util'),
  consumePaymentApproval: jest.fn(),
}));

/**
 * จุดเรียก "กลับรายการตั้งลูกหนี้งวด" ในการยกเลิกใบเสร็จ (คำตัดสินผู้คุมงาน R10) — jest แบบ mock.
 * เงื่อนไขว่าจะกลับหรือไม่อยู่ใน ReceiptVoidReversalTemplate.voidAccrualPostedAtReceipt
 * (receipt-accrual-void.spec.ts); ไฟล์นี้ปักเฉพาะ "เรียกเมื่อไร ด้วยอะไร และบันทึกผลที่ไหน".
 * เส้นทางต่อฐานจริงอยู่ใน accrue-at-receipt.integration.spec.ts
 */
const dec = (n: string | number) => new Prisma.Decimal(n);
const DAY_MS = 86_400_000;

const RECEIPT_ID = 'rcpt-1';
const PAYMENT_ID = 'pay-inst-3';
const CONTRACT_ID = 'contract-1';
const SCHEDULE_ID = 'inst-3';
const APPROVAL = { requestId: 'void-request', actorId: 'approver-1' };

function setup(
  opts: {
    /** แถวตารางงวด — null = สัญญาเก่าที่ไม่มีตารางงวด */
    schedule?: { id: string } | null;
    /** รายการที่ยังล้างลูกหนี้ของงวดอยู่หลังกลับใบรับชำระ (เช่น เงินรับล่วงหน้าที่รอบกลางคืนหัก) */
    survivingEntries?: unknown[];
    accrualVoid?: jest.Mock;
  } = {},
) {
  const calls: string[] = [];
  const journalFindMany = jest
    .fn()
    // ครั้งที่ 1: ตัวจับคู่ใบรับชำระของ Payment — fixture นี้ไม่มีรายการให้กลับ
    .mockResolvedValueOnce([])
    // ครั้งที่ 2: reconstructPriorCleared หลังกลับใบรับชำระ
    .mockResolvedValueOnce(opts.survivingEntries ?? []);

  const tx = {
    receipt: {
      findUnique: jest.fn().mockResolvedValue({
        id: RECEIPT_ID,
        receiptNumber: 'RT-202609-00012',
        contractId: CONTRACT_ID,
        paymentId: PAYMENT_ID,
        receiptType: 'INSTALLMENT',
        payerName: 'ทดสอบ จ่ายล่วงหน้า',
        receiverName: 'พนักงานทดสอบ',
        amount: dec('1515.83'),
        installmentNo: 3,
        paymentMethod: 'CASH',
        paidDate: new Date(Date.now() - 2 * DAY_MS),
        createdAt: new Date(Date.now() - 2 * DAY_MS),
        isVoided: false,
        deletedAt: null,
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, id: `cn-${String(data.receiptNumber)}` }),
      ),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: CONTRACT_ID, status: 'ACTIVE' }),
      update: jest.fn().mockResolvedValue({}),
    },
    journalEntry: { findMany: journalFindMany },
    payment: {
      findUnique: jest.fn().mockResolvedValue({
        id: PAYMENT_ID,
        status: 'PAID',
        amountPaid: dec('1515.83'),
        amountDue: dec('1515.83'),
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        contractId: CONTRACT_ID,
        installmentNo: 3,
        deletedAt: null,
      }),
      update: jest.fn().mockImplementation(() => {
        calls.push('payment.update');
        return Promise.resolve({});
      }),
    },
    installmentSchedule: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.schedule === undefined ? { id: SCHEDULE_ID } : opts.schedule),
    },
    loyaltyPoint: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'approver-1', role: 'OWNER', isActive: true, deletedAt: null }),
    },
    // ไม่ได้ตั้งค่าบริษัท FINANCE ใน fixture → validatePeriodOpen ไม่ตรวจ (ไม่มี companyId)
    companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;

  const numbers = {
    generateReceiptNumber: jest.fn().mockResolvedValue('RT-202609-00013'),
  } as unknown as ReceiptNumberService;

  const accrualVoid =
    opts.accrualVoid ??
    jest.fn().mockImplementation(() => {
      calls.push('accrual-void');
      return Promise.resolve({
        reversed: true,
        entryNo: 'JE-202609-00091',
        accrualEntryNumber: 'JE-202609-00077',
      });
    });
  const reversal = {
    voidReceipt: jest.fn(),
    voidAccrualPostedAtReceipt: accrualVoid,
  } as unknown as ReceiptVoidReversalTemplate;

  const service = new ReceiptVoidService(prisma, reversal, numbers);
  const run = () =>
    service.voidReceipt(RECEIPT_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', APPROVAL);
  const auditNewValue = () =>
    (tx.auditLog.create.mock.calls[0][0] as { data: { newValue: Record<string, unknown> } }).data
      .newValue;
  return { run, tx, accrualVoid, calls, auditNewValue };
}

describe('ReceiptVoidService — กลับรายการตั้งลูกหนี้งวดเมื่องวดไม่เหลือการรับชำระที่มีผล', () => {
  beforeEach(() => {
    (consumePaymentApproval as jest.Mock)
      .mockReset()
      .mockResolvedValue({ requestedById: 'maker-1', approverId: 'approver-1', payload: {} });
  });

  it('งวดไม่เหลือการรับชำระที่มีผล → เรียกด้วยธุรกรรมเดียวกัน หลังคืนสถานะแถวงวด และบันทึกผลในแถว RECEIPT_VOID', async () => {
    const { run, tx, accrualVoid, calls, auditNewValue } = setup();

    await run();

    expect(accrualVoid).toHaveBeenCalledTimes(1);
    expect(accrualVoid).toHaveBeenCalledWith(SCHEDULE_ID, tx);
    expect(calls).toEqual(['payment.update', 'accrual-void']);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(auditNewValue().accrualReversal).toEqual({
      reversed: true,
      entryNo: 'JE-202609-00091',
      accrualEntryNumber: 'JE-202609-00077',
    });
  });

  it('template ตอบว่าไม่กลับ (เช่น ถึงวันครบกำหนดแล้ว) → การยกเลิกสำเร็จตามเดิม และบันทึกเหตุผล', async () => {
    const { run, tx, auditNewValue } = setup({
      accrualVoid: jest.fn().mockResolvedValue({ reversed: false, reason: 'DUE_DATE_REACHED' }),
    });

    const out = await run();

    expect(out.paymentReverted).toEqual(
      expect.objectContaining({ paymentId: PAYMENT_ID, toStatus: 'PENDING' }),
    );
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: 'PENDING', amountPaid: 0, paidDate: null },
    });
    expect(auditNewValue().accrualReversal).toEqual({
      reversed: false,
      reason: 'DUE_DATE_REACHED',
    });
  });

  it('งวดยังมียอดที่ถูกล้างเหลืออยู่ (เงินรับล่วงหน้าที่รอบกลางคืนหักเข้างวด 500) → ไม่เรียก', async () => {
    const { run, accrualVoid, tx, auditNewValue } = setup({
      survivingEntries: [
        {
          metadata: {
            tag: '2B',
            flow: 'advance-consume-on-accrual',
            installmentScheduleId: SCHEDULE_ID,
          },
          lines: [{ accountCode: '11-2103', debit: dec(0), credit: dec('500') }],
        },
      ],
    });

    await run();

    expect(accrualVoid).not.toHaveBeenCalled();
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: 'PARTIALLY_PAID', amountPaid: dec('500'), paidDate: null },
    });
    expect(auditNewValue().accrualReversal).toBeNull();
  });

  it('สัญญาที่ไม่มีแถวตารางงวด → ไม่เรียก', async () => {
    const { run, accrualVoid, auditNewValue } = setup({ schedule: null });

    await run();

    expect(accrualVoid).not.toHaveBeenCalled();
    expect(auditNewValue().accrualReversal).toBeNull();
  });

  it('การกลับรายการล้ม → การยกเลิกใบเสร็จล้มทั้งรายการ ด้วย error เดิม และไม่เขียน audit', async () => {
    const failure = new Prisma.PrismaClientKnownRequestError('conflict', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { run, tx } = setup({ accrualVoid: jest.fn().mockRejectedValue(failure) });

    await expect(run()).rejects.toBe(failure);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('ค่าที่คืนให้ผู้เรียกเป็นรูปเดิม', async () => {
    const { run } = setup();

    const out = await run();

    expect(Object.keys(out).sort()).toEqual(['creditNote', 'paymentReverted', 'voidedReceipt']);
  });
});

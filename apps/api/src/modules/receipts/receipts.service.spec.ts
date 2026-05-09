import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';

// Mock the period-lock util so the test isn't blocked by closed-period validation.
jest.mock('../../utils/period-lock.util', () => ({
  validatePeriodOpen: jest.fn().mockResolvedValue(undefined),
}));

describe('ReceiptsService', () => {
  let service: ReceiptsService;
  let prisma: any;
  let journalAutoService: any;

  const receiptId = 'rcpt-1';
  const userId = 'user-1';
  const approverId = 'user-2';

  beforeEach(async () => {
    // Build a tx mock that exposes the same surface as PrismaService used inside
    // voidReceipt's $transaction callback.
    const txMock = {
      receipt: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      journalEntry: {
        findFirst: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    prisma = {
      receipt: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
      __tx: txMock,
    };

    journalAutoService = {
      createReversalJournal: jest.fn(),
    };

    const lineOaService = {} as Partial<LineOaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: journalAutoService },
        { provide: LineOaService, useValue: lineOaService },
        { provide: ReceiptVoidReversalTemplate, useValue: { voidReceipt: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
      ],
    }).compile();

    service = module.get<ReceiptsService>(ReceiptsService);
  });

  describe('voidReceipt', () => {
    it('voids receipt and calls ReceiptVoidReversalTemplate when original JE exists (Phase A.5a)', async () => {
      const tx = prisma.__tx;

      // Existing receipt that can be voided (issued recently, has paymentId).
      tx.receipt.findUnique.mockResolvedValue({
        id: receiptId,
        receiptNumber: 'RT-202604-00001',
        contractId: 'ct-1',
        paymentId: 'pay-1',
        payerName: 'Customer A',
        receiverName: 'Cashier',
        amount: 1000,
        installmentNo: 1,
        paymentMethod: 'CASH',
        isVoided: false,
        deletedAt: null,
        createdAt: new Date(), // today → within 30-day limit
        paidDate: new Date(),
      });

      tx.receipt.create.mockResolvedValue({
        id: 'cn-1',
        receiptNumber: 'RT-202604-00002',
        receiptType: 'CREDIT_NOTE',
      });
      tx.receipt.update.mockResolvedValue({ id: receiptId, isVoided: true });

      // Original posted journal entry exists.
      tx.journalEntry.findFirst.mockResolvedValue({
        id: 'je-1',
        referenceType: 'PAYMENT',
        referenceId: 'pay-1',
        status: 'POSTED',
      });

      const result = await service.voidReceipt(receiptId, 'wrong amount', userId, approverId);

      expect(result.voidedReceipt).toBeDefined();
      expect(result.creditNote).toBeDefined();

      // Phase A.5a: reversal JE posted via ReceiptVoidReversalTemplate
      // (PR #780 Wave 1 P0: tx is forwarded so JE post + receipt void roll back together)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).receiptVoidReversalTemplate;
      expect(template.voidReceipt).toHaveBeenCalledWith('je-1', expect.anything());
    });

    it('JE reversal failure rolls the entire void back (Wave 1 P0 — atomicity)', async () => {
      // Wave 1 P0: ReceiptVoidReversalTemplate errors must propagate so the
      // outer $transaction rolls back. Without this, the receipt would be
      // marked VOIDED but the ledger would still show the original payment JE
      // — leaving HP receivable cleared with no offsetting credit-note JE.
      const tx = prisma.__tx;

      tx.receipt.findUnique.mockResolvedValue({
        id: receiptId,
        receiptNumber: 'RT-202604-00001',
        contractId: 'ct-1',
        paymentId: 'pay-1',
        payerName: 'Customer A',
        receiverName: 'Cashier',
        amount: 1000,
        installmentNo: 1,
        paymentMethod: 'CASH',
        isVoided: false,
        deletedAt: null,
        createdAt: new Date(),
        paidDate: new Date(),
      });

      tx.receipt.create.mockResolvedValue({
        id: 'cn-1',
        receiptNumber: 'RT-202604-00002',
        receiptType: 'CREDIT_NOTE',
      });
      tx.receipt.update.mockResolvedValue({ id: receiptId, isVoided: true });

      tx.journalEntry.findFirst.mockResolvedValue({
        id: 'je-1',
        referenceType: 'PAYMENT',
        referenceId: 'pay-1',
        status: 'POSTED',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).receiptVoidReversalTemplate;
      template.voidReceipt.mockRejectedValueOnce(new Error('JE reversal failed'));

      // Must throw — outer $transaction rolls back the receipt.update + auditLog
      await expect(
        service.voidReceipt(receiptId, 'wrong amount', userId, approverId),
      ).rejects.toThrow('JE reversal failed');
    });
  });

  describe('voidReceipt — Wave 3 T2 authorization (ปพพ.386 W-3)', () => {
    const validReceiptMock = () => ({
      id: receiptId,
      receiptNumber: 'RT-202604-00001',
      contractId: 'ct-1',
      paymentId: 'pay-1',
      payerName: 'Customer A',
      receiverName: 'Cashier',
      amount: 1000,
      installmentNo: 1,
      paymentMethod: 'CASH',
      isVoided: false,
      deletedAt: null,
      createdAt: new Date(),
      paidDate: new Date(),
    });

    const setupHappyPath = (tx: any) => {
      tx.receipt.findUnique.mockResolvedValue(validReceiptMock());
      tx.receipt.create.mockResolvedValue({
        id: 'cn-1',
        receiptNumber: 'RT-202604-00002',
        receiptType: 'CREDIT_NOTE',
      });
      tx.receipt.update.mockResolvedValue({ id: receiptId, isVoided: true });
      tx.journalEntry.findFirst.mockResolvedValue(null); // no JE → skip reversal
    };

    it('throws ForbiddenException when SALES role attempts to void', async () => {
      const tx = prisma.__tx;
      setupHappyPath(tx);

      await expect(
        service.voidReceipt(receiptId, 'wrong amount', userId, approverId, 'SALES'),
      ).rejects.toThrow(ForbiddenException);

      // Audit log must NOT be created on rejection
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('allows OWNER role and writes RECEIPT_VOID audit log', async () => {
      const tx = prisma.__tx;
      setupHappyPath(tx);

      const result = await service.voidReceipt(
        receiptId,
        'wrong amount',
        userId,
        approverId,
        'OWNER',
      );

      expect(result.voidedReceipt).toBeDefined();
      expect(result.creditNote).toBeDefined();

      // Audit log written with correct shape
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = tx.auditLog.create.mock.calls[0][0];
      expect(auditCall.data.action).toBe('RECEIPT_VOID');
      expect(auditCall.data.entity).toBe('receipt');
      expect(auditCall.data.entityId).toBe(receiptId);
      expect(auditCall.data.userId).toBe(userId);
      expect(auditCall.data.newValue.reason).toBe('wrong amount');
      expect(auditCall.data.newValue.userRole).toBe('OWNER');
      expect(auditCall.data.newValue.creditNoteId).toBe('cn-1');
      expect(auditCall.data.oldValue.receiptNumber).toBe('RT-202604-00001');
    });

    it('allows ACCOUNTANT role', async () => {
      const tx = prisma.__tx;
      setupHappyPath(tx);

      await expect(
        service.voidReceipt(receiptId, 'wrong amount', userId, approverId, 'ACCOUNTANT'),
      ).resolves.toBeDefined();
    });

    it('allows BRANCH_MANAGER role', async () => {
      const tx = prisma.__tx;
      setupHappyPath(tx);

      await expect(
        service.voidReceipt(receiptId, 'wrong amount', userId, approverId, 'BRANCH_MANAGER'),
      ).resolves.toBeDefined();
    });

    it('allows FINANCE_MANAGER role', async () => {
      const tx = prisma.__tx;
      setupHappyPath(tx);

      await expect(
        service.voidReceipt(receiptId, 'wrong amount', userId, approverId, 'FINANCE_MANAGER'),
      ).resolves.toBeDefined();
    });

    it('falls back to defensive allow when userRole is undefined (legacy callers)', async () => {
      // Service-layer guard skips role check if undefined — controller is
      // single source of truth via @Roles. Defensive layer rejects only if
      // a known-bad role is explicitly passed.
      const tx = prisma.__tx;
      setupHappyPath(tx);

      await expect(
        service.voidReceipt(receiptId, 'wrong amount', userId, approverId),
      ).resolves.toBeDefined();
    });
  });

  describe('generateReceipt — RT-YYYYMM format + partial fields', () => {
    function buildPrismaForGenerate(opts: {
      lastReceiptNumber?: string;
      paymentStatus: 'PAID' | 'PARTIALLY_PAID';
      amountDue: string;
      priorReceipts: Array<{ amount: string }>;
    }) {
      const created = jest.fn(async ({ data }: any) => ({ id: 'rcpt-new', ...data }));
      const tx = {
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'ct-1',
            financedAmount: '20000',
            totalMonths: 12,
            customer: { name: 'ลูกค้า ก' },
            payments: [],
            deletedAt: null,
          }),
        },
        companyInfo: {
          findFirst: jest.fn().mockResolvedValue({ nameTh: 'BESTCHOICE FINANCE' }),
        },
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            status: opts.paymentStatus,
            amountDue: opts.amountDue,
          }),
        },
        receipt: {
          findMany: jest.fn().mockResolvedValue(opts.priorReceipts),
          create: created,
        },
        customer: { findFirst: jest.fn().mockResolvedValue(null) },
        $queryRaw: jest
          .fn()
          // pg_advisory_xact_lock — no-op
          .mockResolvedValueOnce(undefined)
          // last receipt number lookup
          .mockResolvedValueOnce(
            opts.lastReceiptNumber
              ? [{ receiptNumber: opts.lastReceiptNumber }]
              : [],
          ),
      };
      const local = {
        $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
        __tx: tx,
        __created: created,
      };
      return local;
    }

    function buildService(localPrisma: any) {
      return new ReceiptsService(
        localPrisma,
        { createReversalJournal: jest.fn() } as any,
        { voidReceipt: jest.fn() } as any,
        {} as any,
      );
    }

    it('generates RT-YYYYMM-NNNNN with seq=1 when month is empty', async () => {
      const local = buildPrismaForGenerate({
        paymentStatus: 'PAID',
        amountDue: '1515.83',
        priorReceipts: [],
      });
      const svc = buildService(local);

      await svc.generateReceipt('ct-1', 'pay-1', 'INSTALLMENT', 1515.83, 1, 'CASH', null, 'u-1');

      const data = local.__created.mock.calls[0][0].data;
      expect(data.receiptNumber).toMatch(/^RT-\d{6}-00001$/);
      expect(data.paymentStatus).toBe('PAID');
      expect(data.installmentPartialSeq).toBeNull();
    });

    it('increments seq from last receipt of the same month', async () => {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const local = buildPrismaForGenerate({
        lastReceiptNumber: `RT-${yyyymm}-00042`,
        paymentStatus: 'PAID',
        amountDue: '1515.83',
        priorReceipts: [],
      });
      const svc = buildService(local);

      await svc.generateReceipt('ct-1', 'pay-1', 'INSTALLMENT', 1515.83, 1, 'CASH', null, 'u-1');

      const data = local.__created.mock.calls[0][0].data;
      expect(data.receiptNumber).toBe(`RT-${yyyymm}-00043`);
    });

    it('partial payment: paymentStatus=PARTIAL, installmentPartialSeq counts prior receipts +1, remainingAmount = due - cumulative', async () => {
      const local = buildPrismaForGenerate({
        paymentStatus: 'PARTIALLY_PAID',
        amountDue: '1515.83',
        priorReceipts: [{ amount: '500' }, { amount: '300' }],
      });
      const svc = buildService(local);

      await svc.generateReceipt('ct-1', 'pay-1', 'INSTALLMENT', 200, 1, 'CASH', null, 'u-1');

      const data = local.__created.mock.calls[0][0].data;
      expect(data.paymentStatus).toBe('PARTIAL');
      expect(data.installmentPartialSeq).toBe(3);
      // 1515.83 - (500 + 300 + 200) = 515.83
      expect(data.remainingAmount.toString()).toBe('515.83');
    });

    it('final partial payment that clears installment: paymentStatus=PAID, seq=null, remainingAmount=0', async () => {
      const local = buildPrismaForGenerate({
        paymentStatus: 'PAID',
        amountDue: '1515.83',
        priorReceipts: [{ amount: '500' }, { amount: '500' }],
      });
      const svc = buildService(local);

      await svc.generateReceipt('ct-1', 'pay-1', 'INSTALLMENT', 515.83, 1, 'CASH', null, 'u-1');

      const data = local.__created.mock.calls[0][0].data;
      expect(data.paymentStatus).toBe('PAID');
      expect(data.installmentPartialSeq).toBeNull();
      expect(data.remainingAmount.toString()).toBe('0');
    });

    it('clamps remainingAmount to 0 when overpay is recorded as receipt', async () => {
      const local = buildPrismaForGenerate({
        paymentStatus: 'PAID',
        amountDue: '1515.83',
        priorReceipts: [],
      });
      const svc = buildService(local);

      // Customer pays 1600 (overpay 84.17) — remainingAmount should clamp to 0,
      // not surface as negative.
      await svc.generateReceipt('ct-1', 'pay-1', 'INSTALLMENT', 1600, 1, 'CASH', null, 'u-1');

      const data = local.__created.mock.calls[0][0].data;
      expect(data.remainingAmount.toString()).toBe('0');
    });
  });
});

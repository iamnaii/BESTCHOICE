import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptsService } from './receipts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { LineOaService } from '../line-oa/line-oa.service';

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
      ],
    }).compile();

    service = module.get<ReceiptsService>(ReceiptsService);
  });

  describe('voidReceipt', () => {
    it('rolls back receipt void if reversal JE throws (F-1-017)', async () => {
      const tx = prisma.__tx;

      // Existing receipt that can be voided (issued recently, has paymentId).
      tx.receipt.findUnique.mockResolvedValue({
        id: receiptId,
        receiptNumber: 'RC-2026-04-00001',
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
      });

      tx.receipt.create.mockResolvedValue({
        id: 'cn-1',
        receiptNumber: 'RC-2026-04-00002',
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

      // Reversal JE creation throws.
      journalAutoService.createReversalJournal.mockRejectedValueOnce(
        new Error('JE reversal failed'),
      );

      await expect(
        service.voidReceipt(receiptId, 'wrong amount', userId, approverId),
      ).rejects.toThrow('JE reversal failed');

      // The error must propagate out of $transaction so Prisma rolls back the
      // receipt.update({ isVoided: true }) write. Pre-fix, a try/catch swallowed
      // the error and the void was committed without a reversal JE — silent
      // ledger divergence (audit F-1-017).
      expect(journalAutoService.createReversalJournal).toHaveBeenCalledTimes(1);
    });
  });
});

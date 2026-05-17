import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { IntercompanyService } from './intercompany.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';

describe('IntercompanyService (Phase A.3 W-5)', () => {
  let service: IntercompanyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journalAuto: any;

  beforeEach(async () => {
    prisma = {
      companyInfo: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
          if (where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
          return Promise.resolve(null);
        }),
      },
      journalLine: {
        aggregate: jest.fn(),
      },
      interCompanyTransaction: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: {
        update: jest.fn().mockResolvedValue({}),
      },
      // For validatePeriodOpen — period unlocked by default.
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    journalAuto = {
      createAndPost: jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202605-00001' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntercompanyService,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: journalAuto },
      ],
    }).compile();
    service = module.get(IntercompanyService);
  });

  describe('getOutstandingBalance', () => {
    it('returns matched balances when invariant holds', async () => {
      prisma.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { debit: 10600, credit: 0 } }) // SHOP 11-2105 Dr
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 10600 } }); // FINANCE 21-1102 Cr

      const result = await service.getOutstandingBalance();
      expect(result.shopReceivableFromFinance).toBeCloseTo(10600, 2);
      expect(result.financeOwesToShop).toBeCloseTo(10600, 2);
      expect(result.balanced).toBe(true);
      expect(result.drift).toBeCloseTo(0, 2);
    });

    it('detects drift when invariant breaks', async () => {
      prisma.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { debit: 10600, credit: 0 } })
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 10500 } });

      const result = await service.getOutstandingBalance();
      expect(result.balanced).toBe(false);
      expect(result.drift).toBeCloseTo(100, 2);
    });

    it('handles partially settled balance correctly (Dr offsets on FINANCE)', async () => {
      // After 2,000 settlement: shop Dr 10600 Cr 2000, finance Cr 10600 Dr 2000 → balance 8600
      prisma.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { debit: 10600, credit: 2000 } })
        .mockResolvedValueOnce({ _sum: { debit: 2000, credit: 10600 } });

      const result = await service.getOutstandingBalance();
      expect(result.shopReceivableFromFinance).toBeCloseTo(8600, 2);
      expect(result.financeOwesToShop).toBeCloseTo(8600, 2);
      expect(result.balanced).toBe(true);
    });

    it('throws when SHOP company not configured', async () => {
      prisma.companyInfo.findFirst = jest.fn().mockResolvedValue(null);
      await expect(service.getOutstandingBalance()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('settle', () => {
    beforeEach(() => {
      prisma.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { debit: 10600, credit: 0 } })
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 10600 } });
    });

    it('records settlement when amount within outstanding balance (Phase A.4 — JE deferred to A.5)', async () => {
      const result = await service.settle(
        { amount: 5000, reference: 'TXN-2026-04-1' },
        'user-1',
      );
      // Phase A.4: IC settlement JE is a stub (deferred to Phase A.5 SHOP-side accounting)
      // The settle() still returns the correct amounts without a JE call.
      expect(result.amount).toBe(5000);
      expect(result.remainingBalance).toBeCloseTo(5600, 2);
    });

    it('rejects when amount exceeds outstanding balance', async () => {
      await expect(
        service.settle({ amount: 11000, reference: 'TXN-OVER' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows settling exact outstanding balance', async () => {
      const result = await service.settle(
        { amount: 10600, reference: 'TXN-FULL' },
        'user-1',
      );
      expect(result.remainingBalance).toBeCloseTo(0, 2);
    });
  });

  // SP2: settle with transactionId — posts real JE and flips status
  describe('settle (SP2 — with transactionId)', () => {
    beforeEach(() => {
      // Outstanding 10600 balance available (pre-flight check)
      prisma.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { debit: 10600, credit: 0 } })
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 10600 } });
    });

    it('posts JE Dr 21-1101 + Dr 21-1102 / Cr 11-1201 and flips status to RECONCILED', async () => {
      prisma.interCompanyTransaction.findFirst.mockResolvedValue({
        id: 'ict-1',
        status: 'PENDING',
        principal: 9600,
        commission: 1000,
        totalAmount: 10600,
        journalEntryId: null,
      });

      const result = await service.settle(
        {
          amount: 10600,
          reference: 'TXN-2026-04-1',
          transactionId: 'ict-1',
          depositAccountCode: '11-1201',
        },
        'user-1',
      );

      expect(journalAuto.createAndPost).toHaveBeenCalledTimes(1);
      const jeArg = journalAuto.createAndPost.mock.calls[0][0];
      const codes = jeArg.lines.map((l: { accountCode: string }) => l.accountCode);
      expect(codes).toEqual(['21-1101', '21-1102', '11-1201']);
      // Dr equals Cr (balanced)
      const drs = jeArg.lines.reduce(
        (s: number, l: { dr: { toString: () => string } }) => s + parseFloat(l.dr.toString()),
        0,
      );
      const crs = jeArg.lines.reduce(
        (s: number, l: { cr: { toString: () => string } }) => s + parseFloat(l.cr.toString()),
        0,
      );
      expect(drs).toBeCloseTo(crs, 2);
      expect(drs).toBeCloseTo(10600, 2);

      // Status flip happens with journalEntryId stored
      expect(prisma.interCompanyTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ict-1' },
          data: expect.objectContaining({
            status: 'RECONCILED',
            journalEntryId: 'je-1',
          }),
        }),
      );

      const settled = result as {
        journalEntryId: string;
        entryNumber: string;
        remainingBalance: number;
      };
      expect(settled.journalEntryId).toBe('je-1');
      expect(settled.entryNumber).toBe('JE-202605-00001');
      expect(settled.remainingBalance).toBeCloseTo(0, 2);
    });

    it('rejects idempotently when txn already RECONCILED', async () => {
      prisma.interCompanyTransaction.findFirst.mockResolvedValue({
        id: 'ict-1',
        status: 'RECONCILED',
        principal: 9600,
        commission: 1000,
        totalAmount: 10600,
        journalEntryId: 'je-existing',
      });

      await expect(
        service.settle(
          { amount: 10600, reference: 'TXN-2026-04-1', transactionId: 'ict-1' },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(journalAuto.createAndPost).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when txn missing', async () => {
      prisma.interCompanyTransaction.findFirst.mockResolvedValue(null);
      await expect(
        service.settle(
          { amount: 10600, reference: 'TXN-X', transactionId: 'ict-missing' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when dto.amount does not match txn principal+commission (>1 satang)', async () => {
      prisma.interCompanyTransaction.findFirst.mockResolvedValue({
        id: 'ict-1',
        status: 'PENDING',
        principal: 9600,
        commission: 1000,
        totalAmount: 10600,
        journalEntryId: null,
      });
      await expect(
        service.settle(
          { amount: 9000, reference: 'TXN-MISMATCH', transactionId: 'ict-1' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // SP2 Critical #4 — period guard before posting settlement JE
    it('rejects when paidDate falls in a CLOSED accounting period', async () => {
      // Spec assumes a real paidDate well past the grace window — use a date
      // 2 years ago so the 5-day grace window cannot rescue it.
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 2);
      const paidDate = oldDate.toISOString();

      prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });
      prisma.interCompanyTransaction.findFirst.mockResolvedValue({
        id: 'ict-1',
        status: 'PENDING',
        principal: 9600,
        commission: 1000,
        totalAmount: 10600,
        journalEntryId: null,
      });

      await expect(
        service.settle(
          {
            amount: 10600,
            reference: 'TXN-CLOSED',
            transactionId: 'ict-1',
            paidDate,
          },
          'user-1',
        ),
      ).rejects.toThrow(/งวดที่ปิดแล้ว/);
      expect(journalAuto.createAndPost).not.toHaveBeenCalled();
      expect(prisma.interCompanyTransaction.update).not.toHaveBeenCalled();
    });

    it('succeeds against an OPEN period (period guard passes)', async () => {
      // status not CLOSED → period guard returns silently
      prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'OPEN' });
      prisma.interCompanyTransaction.findFirst.mockResolvedValue({
        id: 'ict-1',
        status: 'PENDING',
        principal: 9600,
        commission: 1000,
        totalAmount: 10600,
        journalEntryId: null,
      });

      const result = await service.settle(
        {
          amount: 10600,
          reference: 'TXN-OPEN',
          transactionId: 'ict-1',
        },
        'user-1',
      );
      expect(journalAuto.createAndPost).toHaveBeenCalledTimes(1);
      const settled = result as { journalEntryId: string };
      expect(settled.journalEntryId).toBe('je-1');
    });
  });
});

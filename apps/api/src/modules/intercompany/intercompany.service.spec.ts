import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { IntercompanyService } from './intercompany.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';

describe('IntercompanyService (Phase A.3 W-5)', () => {
  let service: IntercompanyService;
  let prisma: {
    companyInfo: { findFirst: jest.Mock };
    journalLine: { aggregate: jest.Mock };
    $transaction: jest.Mock;
  };
  let journalAuto: { createInterCompanySettlementJournal: jest.Mock };

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
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };
    journalAuto = {
      createInterCompanySettlementJournal: jest.fn().mockResolvedValue({
        financeEntryId: 'je-finance',
        shopEntryId: 'je-shop',
      }),
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

    it('posts settlement when amount within outstanding balance', async () => {
      const result = await service.settle(
        { amount: 5000, reference: 'TXN-2026-04-1' },
        'user-1',
      );
      expect(journalAuto.createInterCompanySettlementJournal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ amount: 5000, reference: 'TXN-2026-04-1', userId: 'user-1' }),
      );
      expect(result.amount).toBe(5000);
      expect(result.remainingBalance).toBeCloseTo(5600, 2);
      // TODO Phase A.4 T13: financeEntryId/shopEntryId removed — IC settlement journal is now a stub
    });

    it('rejects when amount exceeds outstanding balance', async () => {
      await expect(
        service.settle({ amount: 11000, reference: 'TXN-OVER' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(journalAuto.createInterCompanySettlementJournal).not.toHaveBeenCalled();
    });

    it('allows settling exact outstanding balance', async () => {
      const result = await service.settle(
        { amount: 10600, reference: 'TXN-FULL' },
        'user-1',
      );
      expect(result.remainingBalance).toBeCloseTo(0, 2);
    });
  });
});

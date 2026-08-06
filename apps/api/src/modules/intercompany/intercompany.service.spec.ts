import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { IntercompanyService } from './intercompany.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * getOutstandingBalance — formula fixed 2026-07-30 (spec §4/§9): FINANCE now
 * reads `21-1101`+`21-1102` (was `21-1102` only) and SHOP reads
 * `S11-3001`+`S11-3002` (was the never-posted-to `11-2105`). `settle()` /
 * `settleWithJournal()` were retired the same day — settlement now lives in
 * the `interco-settlement` module (batch lifecycle + paired JE). See
 * `intercompany.controller.spec.ts` for the 410 on the old POST /settle route.
 */
describe('IntercompanyService (getOutstandingBalance — formula fixed 2026-07-30)', () => {
  let service: IntercompanyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

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
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [IntercompanyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(IntercompanyService);
  });

  describe('getOutstandingBalance', () => {
    it('returns matched balances when invariant holds (SHOP S11-3001/3002 vs FINANCE 21-1101/1102)', async () => {
      prisma.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { debit: 10600, credit: 0 } }) // SHOP S11-3001+3002 Dr
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 10600 } }); // FINANCE 21-1101+1102 Cr

      const result = await service.getOutstandingBalance();
      expect(result.shopReceivableFromFinance).toBeCloseTo(10600, 2);
      expect(result.financeOwesToShop).toBeCloseTo(10600, 2);
      expect(result.balanced).toBe(true);
      expect(result.drift).toBeCloseTo(0, 2);
      expect(result.driftNote).toBe(
        'ส่วนต่าง = สัญญาก่อน 2026-06-23/เปลี่ยนเครื่อง (สมุด SHOP ยังไม่ตั้งลูกหนี้)',
      );
    });

    it('detects drift when invariant breaks (e.g. legacy pre-2026-06-23 contracts — expected, not necessarily a bug)', async () => {
      prisma.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { debit: 10600, credit: 0 } })
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 10500 } });

      const result = await service.getOutstandingBalance();
      expect(result.balanced).toBe(false);
      expect(result.drift).toBeCloseTo(100, 2);
    });

    it('handles partially settled balance correctly (Dr/Cr offsets on both sides)', async () => {
      // After a 2,000 settlement: SHOP Dr 10600 Cr 2000, FINANCE Cr 10600 Dr 2000 → balance 8600
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
});

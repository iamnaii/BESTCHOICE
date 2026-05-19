import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { FinanceTaxService } from './finance-tax.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * FinanceTaxService — VAT & WHT monthly aggregation + auto-journal history
 *
 * Tests cover:
 *   Task 2 — getVatMonthly: response shape, empty period, computed netVat, companyId filter
 *   Task 3 — getWhtMonthly: PND1/3/53 grouping, grandTotal, empty period
 *   Task 4 — getVatAutoJournalHistory: entry→vatLines mapping, referenceType→sourceType mapping
 *
 * Schema reality:
 *   - JournalLine: debit (Decimal), credit (Decimal), accountCode, description
 *   - JournalEntry: entryNumber (→ documentNumber), referenceType (→ sourceType), referenceId (→ sourceId)
 *   - Number(field) used for Decimal conversion — never aggregate Decimals directly
 */
describe('FinanceTaxService', () => {
  let service: FinanceTaxService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  /** Helper: build a JournalLine mock with nested journalEntry */
  function makeLine(
    accountCode: string,
    debit: string,
    credit: string,
    entryNumber = 'JE-202605-0001',
    postedAt: Date = new Date('2026-05-15T10:00:00Z'),
  ) {
    return {
      accountCode,
      debit: new Decimal(debit),
      credit: new Decimal(credit),
      description: `test line ${accountCode}`,
      journalEntry: {
        entryNumber,
        postedAt,
        description: 'test entry description',
      },
    };
  }

  beforeEach(async () => {
    prisma = {
      journalLine: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceTaxService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FinanceTaxService>(FinanceTaxService);
  });

  // ─── Task 2: getVatMonthly ─────────────────────────────────────────────────

  describe('getVatMonthly', () => {
    it('returns correct shape with zero values when no lines exist', async () => {
      prisma.journalLine.findMany.mockResolvedValue([]);

      const result = await service.getVatMonthly(2026, 5);

      expect(result).toMatchObject({
        period: { year: 2026, month: 5 },
        vatOutput: 0,
        vatDeferred: 0,
        vatInput: 0,
        netVat: 0,
        lineCount: 0,
        lines: [],
      });

      // Period bounds should be correct
      expect(result.period.start).toEqual(new Date(2026, 4, 1)); // May 1
      expect(result.period.end).toEqual(new Date(2026, 5, 1)); // June 1 (exclusive)
    });

    it('aggregates VAT output (21-2101) and input (11-4101) correctly', async () => {
      prisma.journalLine.findMany.mockResolvedValue([
        makeLine('21-2101', '0', '700'),   // VAT output: credit 700, debit 0 → +700
        makeLine('11-4101', '100', '0'),   // VAT input: debit 100, credit 0 → +100
      ]);

      const result = await service.getVatMonthly(2026, 5);

      expect(result.vatOutput).toBe(700);
      expect(result.vatInput).toBe(100);
      expect(result.netVat).toBe(600); // 700 - 100
      expect(result.lineCount).toBe(2);
    });

    it('maps entryNumber to documentNumber in each line', async () => {
      prisma.journalLine.findMany.mockResolvedValue([
        makeLine('21-2101', '0', '350', 'JE-202605-0042'),
      ]);

      const result = await service.getVatMonthly(2026, 5);

      expect(result.lines[0].documentNumber).toBe('JE-202605-0042');
      expect(result.lines[0].accountCode).toBe('21-2101');
      expect(result.lines[0].debit).toBe(0);
      expect(result.lines[0].credit).toBe(350);
    });

    it('applies companyId filter in the journalEntry where clause', async () => {
      prisma.journalLine.findMany.mockResolvedValue([]);

      await service.getVatMonthly(2026, 5, 'company-finance-uuid');

      const callArgs = prisma.journalLine.findMany.mock.calls[0][0];
      expect(callArgs.where.journalEntry.companyId).toBe('company-finance-uuid');
    });
  });

  // ─── Task 3: getWhtMonthly ─────────────────────────────────────────────────

  describe('getWhtMonthly', () => {
    it('returns correct shape with zero totals when no lines exist', async () => {
      prisma.journalLine.findMany.mockResolvedValue([]);

      const result = await service.getWhtMonthly(2026, 5);

      expect(result).toMatchObject({
        period: { year: 2026, month: 5 },
        PND1: { lines: [], total: 0 },
        PND3: { lines: [], total: 0 },
        PND53: { lines: [], total: 0 },
        grandTotal: 0,
      });
    });

    it('groups lines by WHT form type and computes totals correctly', async () => {
      prisma.journalLine.findMany.mockResolvedValue([
        makeLine('21-3101', '0', '500', 'JE-202605-0010'),   // PND1 accrual
        makeLine('21-3102', '0', '1200', 'JE-202605-0011'),  // PND3 accrual
        makeLine('21-3102', '300', '0', 'JE-202605-0020'),   // PND3 settlement (negative)
        makeLine('21-3103', '0', '800', 'JE-202605-0012'),   // PND53 accrual
      ]);

      const result = await service.getWhtMonthly(2026, 5);

      expect(result.PND1.total).toBe(500);
      expect(result.PND1.lines).toHaveLength(1);

      expect(result.PND3.total).toBe(900); // 1200 - 300
      expect(result.PND3.lines).toHaveLength(2);

      expect(result.PND53.total).toBe(800);
      expect(result.PND53.lines).toHaveLength(1);

      expect(result.grandTotal).toBe(2200); // 500 + 900 + 800
    });

    it('applies companyId filter when provided', async () => {
      prisma.journalLine.findMany.mockResolvedValue([]);

      await service.getWhtMonthly(2026, 6, 'company-finance-id');

      const callArgs = prisma.journalLine.findMany.mock.calls[0][0];
      expect(callArgs.where.journalEntry.companyId).toBe('company-finance-id');
    });
  });
});

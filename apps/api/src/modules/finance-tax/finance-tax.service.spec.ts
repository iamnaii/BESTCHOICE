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
 *   - getVatMonthly (Task 2) aggregates with `Prisma.Decimal` — vatOutput comes from `computePp30OutputVat`
 *     (single ภ.พ.30 calculator, `pp30-output-vat.ts`) and vatDeferred/vatInput/netVat are accumulated with
 *     Decimal `.plus()`/`.minus()`, never `Number()` — all four return as 2-dp strings (`.toFixed(2)`).
 *     Only the per-line `debit`/`credit` inside `lines` are `Number()`, for display in the line table —
 *     never summed. getWhtMonthly (Task 3) still aggregates with `Number()` — untouched by this task.
 */
describe('FinanceTaxService', () => {
  let service: FinanceTaxService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  /**
   * Helper: build a JournalLine mock with nested journalEntry.
   * `hasSettlementLine` (fix round 1, F1, 2026-09-30) simulates the nested `journalEntry.lines`
   * select finding a non-deleted 21-3201 row — marks this line's entry as a VAT-settlement entry.
   * Defaults to false so every existing call site (getWhtMonthly etc.) is unaffected.
   */
  function makeLine(
    accountCode: string,
    debit: string,
    credit: string,
    entryNumber = 'JE-202605-0001',
    postedAt: Date = new Date('2026-05-15T10:00:00Z'),
    hasSettlementLine = false,
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
        ...(hasSettlementLine ? { lines: [{ id: `settlement-${accountCode}` }] } : {}),
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
      // ตัวคำนวณ ภ.พ.30 หาบริษัท FINANCE เมื่อไม่ส่ง companyId (2026-09-30)
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'fin-co' }),
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
    /** บรรทัด 21-2101 / 21-2103 ที่ตัวคำนวณ ภ.พ.30 อ่าน (รูปของ select ใน pp30-output-vat.ts) */
    function makeOutputLine(
      accountCode: string,
      debit: string,
      credit: string,
      metadata: Record<string, unknown> | null = null,
      referenceType: string | null = 'AUTO',
    ) {
      return {
        accountCode,
        debit: new Decimal(debit),
        credit: new Decimal(credit),
        journalEntry: {
          id: `je-${accountCode}-${debit}-${credit}`,
          entryNumber: 'JE-202605-0001',
          entryDate: new Date('2026-05-15T05:00:00Z'),
          referenceType,
          description: 'test entry description',
          metadata,
        },
      };
    }

    /**
     * journalLine.findMany ถูกเรียก 3 ครั้ง: 21-2101 และ 21-2103 ของตัวคำนวณ ภ.พ.30 (`accountCode` เป็นสตริง)
     * และตารางรายการของหน้า (`accountCode: { in: [...] }`)
     */
    function mockVatLines(opts: {
      output?: ReturnType<typeof makeOutputLine>[];
      table?: ReturnType<typeof makeLine>[];
    }) {
      prisma.journalLine.findMany.mockImplementation((args: { where: { accountCode: unknown } }) =>
        Promise.resolve(
          typeof args.where.accountCode === 'string'
            ? (opts.output ?? []).filter((l) => l.accountCode === args.where.accountCode)
            : (opts.table ?? []),
        ),
      );
    }

    /** คำขอของตารางรายการ (ไม่ใช่ของตัวคำนวณ ภ.พ.30) */
    function tableCall() {
      return prisma.journalLine.findMany.mock.calls.find(
        ([args]: [{ where: { accountCode: unknown } }]) =>
          typeof args.where.accountCode !== 'string',
      )[0];
    }

    it('returns correct shape with zero values when no lines exist — Bangkok month bounds', async () => {
      mockVatLines({});

      const result = await service.getVatMonthly(2026, 5);

      expect(result).toMatchObject({
        period: { year: 2026, month: 5 },
        vatOutput: '0.00',
        vatDeferred: '0.00',
        vatInput: '0.00',
        netVat: '0.00',
        lineCount: 0,
        lines: [],
      });
      expect(result.outputVat.totalOutputVat).toBe('0.00');

      // Period bounds = เดือนตามปฏิทินไทย ไม่ขึ้นกับ TZ ของโปรเซส (1 พ.ค. 00:00 น. — 1 มิ.ย. 00:00 น. เวลาไทย)
      expect(result.period.start).toEqual(new Date('2026-04-30T17:00:00.000Z'));
      expect(result.period.end).toEqual(new Date('2026-05-31T17:00:00.000Z')); // exclusive
    });

    it('aggregates VAT output (21-2101) and input (11-4101) correctly', async () => {
      mockVatLines({
        output: [makeOutputLine('21-2101', '0', '700')],
        table: [
          makeLine('21-2101', '0', '700'), // VAT output: credit 700, debit 0 → +700
          makeLine('11-4101', '100', '0'), // VAT input: debit 100, credit 0 → +100
        ],
      });

      const result = await service.getVatMonthly(2026, 5);

      expect(result.vatOutput).toBe('700.00');
      expect(result.vatInput).toBe('100.00');
      expect(result.netVat).toBe('600.00'); // 700 - 100
      expect(result.lineCount).toBe(2);
    });

    it('maps entryNumber to documentNumber in each line', async () => {
      mockVatLines({ table: [makeLine('21-2101', '0', '350', 'JE-202605-0042')] });

      const result = await service.getVatMonthly(2026, 5);

      expect(result.lines[0].documentNumber).toBe('JE-202605-0042');
      expect(result.lines[0].accountCode).toBe('21-2101');
      expect(result.lines[0].debit).toBe(0);
      expect(result.lines[0].credit).toBe(350);
    });

    it('applies companyId filter in the journalEntry where clause (table + PP30 computation)', async () => {
      mockVatLines({});

      await service.getVatMonthly(2026, 5, 'company-finance-uuid');

      expect(tableCall().where.journalEntry.companyId).toBe('company-finance-uuid');
      const outputCall = prisma.journalLine.findMany.mock.calls.find(
        ([args]: [{ where: { accountCode: unknown } }]) => args.where.accountCode === '21-2101',
      )[0];
      expect(outputCall.where.journalEntry.companyId).toBe('company-finance-uuid');
      expect(prisma.companyInfo.findFirst).not.toHaveBeenCalled();
    });

    // ── 2026-09-30: ภาษีขายมาจากตัวคำนวณเดียวของ ภ.พ.30 ──

    it('ภาษีขาย = ตัวคำนวณ ภ.พ.30: 21-2101 หักรายการกลับรายการ / ใบลดหนี้ ⇒ 793.32 · ภาษีขาย 60 วัน (21-2103) เป็นข้อมูลประกอบ ไม่รวม', async () => {
      mockVatLines({
        output: [
          makeOutputLine('21-2101', '0', '99.17', { tag: '2A' }),
          makeOutputLine('21-2101', '99.17', '0', { tag: 'REVERSAL', flow: 'exchange-cancel' }),
          makeOutputLine('21-2101', '0', '99.17', { tag: '2A', trigger: 'receipt' }),
          makeOutputLine('21-2101', '99.17', '0', { tag: 'JP5', flow: 'repossession' }),
          makeOutputLine('21-2101', '0', '793.32', { tag: 'JP5', flow: 'repossession' }),
          makeOutputLine('21-2103', '0', '198.34', { tag: 'VAT60-MANDATORY' }),
          makeOutputLine('21-2103', '99.17', '0', { tag: 'VAT60-REVERSAL' }),
        ],
        table: [makeLine('11-4101', '100', '0')],
      });

      const result = await service.getVatMonthly(2026, 5);

      expect(result.vatOutput).toBe('793.32');
      expect(result.netVat).toBe('693.32'); // 793.32 − ภาษีซื้อ 100.00 (60 วันไม่รวม)
      expect(result.outputVat).toEqual({
        settledGross: '991.66',
        reductionReversal: '99.17',
        reductionCreditNote: '99.17',
        reductionOther: '0.00',
        reductionTotal: '198.34',
        settledNet: '793.32',
        mandatory60DayCredit: '198.34',
        mandatory60DayDebit: '99.17',
        mandatory60DayNet: '99.17',
        mandatory60DayIncluded: false,
        totalOutputVat: '793.32',
      });
    });

    it('ไม่ส่ง companyId → ภาษีขายเป็นของบริษัท FINANCE แต่ตารางและภาษีซื้อยังไม่กรองบริษัท (กติกาเดิม)', async () => {
      mockVatLines({});

      await service.getVatMonthly(2026, 5);

      expect(prisma.companyInfo.findFirst).toHaveBeenCalledWith({
        where: { companyCode: 'FINANCE', deletedAt: null },
        select: { id: true },
      });
      for (const code of ['21-2101', '21-2103']) {
        const call = prisma.journalLine.findMany.mock.calls.find(
          ([args]: [{ where: { accountCode: unknown } }]) => args.where.accountCode === code,
        )[0];
        expect(call.where.journalEntry.companyId).toBe('fin-co');
      }
      expect(tableCall().where.journalEntry).not.toHaveProperty('companyId');
      expect(tableCall().where.accountCode).toEqual({
        in: ['21-2101', '21-2103', '21-2102', '11-4101', '11-2104'],
      });
    });

    // ── 2026-09-30 fix round 1 (controller F1): รายการปิด/ชำระภาษีขาย (แตะ 21-3201)
    // อยู่นอกยอด ภ.พ.30 ของเดือนทั้งใบ — ไม่ใช่แค่ 21-2101 ที่ตัวคำนวณกันออกอยู่แล้ว ──

    it('รายการปิด/ชำระภาษีขาย (มีบรรทัดแตะ 21-3201) ไม่กระทบภาษีซื้อ (11-4101) และไม่โชว์ในตารางรายการ — เหลือ 69.17', async () => {
      mockVatLines({
        output: [makeOutputLine('21-2101', '0', '99.17')], // ภาษีขายของเดือน (ไม่ใช่รายการปิด)
        table: [
          // รายการปิด/ชำระภาษีขาย: Dr 21-2101 99.17 / Cr 11-4101 30.00 / Cr 21-3201 69.17 (ไม่อยู่ในตาราง)
          // — ทั้งสองบรรทัดที่ตารางนี้ query ถึง (21-2101 + 11-4101) อยู่ในรายการเดียวกันที่แตะ 21-3201
          makeLine(
            '21-2101',
            '99.17',
            '0',
            'JE-202605-9001',
            new Date('2026-05-28T10:00:00Z'),
            true,
          ),
          makeLine(
            '11-4101',
            '0',
            '30.00',
            'JE-202605-9001',
            new Date('2026-05-28T10:00:00Z'),
            true,
          ),
          // ซื้อของเดือนตามปกติ — ไม่แตะ 21-3201
          makeLine('11-4101', '30.00', '0', 'JE-202605-9002'),
        ],
      });

      const result = await service.getVatMonthly(2026, 5);

      expect(result.vatOutput).toBe('99.17');
      expect(result.vatInput).toBe('30.00'); // ไม่ใช่ 0.00 — เครดิต 11-4101 ของรายการปิดไม่ถูกนับ
      expect(result.netVat).toBe('69.17');
      expect(result.lineCount).toBe(1);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({
        accountCode: '11-4101',
        documentNumber: 'JE-202605-9002',
      });
    });

    it('ปี/เดือนผิดรูป → 400 "ปี/เดือนไม่ถูกต้อง" ก่อนยิง query ใด ๆ', async () => {
      await expect(service.getVatMonthly(Number.NaN, 5)).rejects.toThrow('ปี/เดือนไม่ถูกต้อง');
      expect(prisma.journalLine.findMany).not.toHaveBeenCalled();
    });

    it('ไม่มีบริษัท FINANCE ในระบบ → 400 ข้อความไทย', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);

      await expect(service.getVatMonthly(2026, 5)).rejects.toThrow(
        'ไม่พบข้อมูลบริษัทฝั่ง FINANCE (บริษัทที่จดภาษีมูลค่าเพิ่ม) — กรุณาติดต่อผู้ดูแลระบบ',
      );
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

  // ─── Task 4: getVatAutoJournalHistory ──────────────────────────────────────

  describe('getVatAutoJournalHistory', () => {
    /** Helper: build a JournalEntry mock with nested VAT lines */
    function makeEntry(
      id: string,
      entryNumber: string,
      referenceType: string | null,
      lines: Array<{ accountCode: string; debit: string; credit: string }>,
    ) {
      return {
        id,
        entryNumber,
        postedAt: new Date('2026-05-15T10:00:00Z'),
        referenceType,
        description: 'auto journal entry',
        lines: lines.map((l) => ({
          accountCode: l.accountCode,
          debit: new Decimal(l.debit),
          credit: new Decimal(l.credit),
        })),
      };
    }

    it('returns empty entries list when no matching journal entries exist', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([]);

      const result = await service.getVatAutoJournalHistory(2026, 5);

      expect(result.entries).toEqual([]);
      expect(result.period.year).toBe(2026);
      expect(result.period.month).toBe(5);
    });

    it('maps entryNumber → documentNumber and referenceType → sourceType', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([
        makeEntry('entry-uuid-1', 'JE-202605-0001', 'PAYMENT', [
          { accountCode: '21-2101', debit: '0', credit: '700' },
          { accountCode: '11-2105', debit: '700', credit: '0' },
        ]),
      ]);

      const result = await service.getVatAutoJournalHistory(2026, 5);

      const entry = result.entries[0];
      expect(entry.documentNumber).toBe('JE-202605-0001'); // entryNumber → documentNumber
      expect(entry.sourceType).toBe('PAYMENT'); // referenceType → sourceType
      expect(entry.vatLines).toHaveLength(2);
      expect(entry.vatLines[0].accountCode).toBe('21-2101');
      expect(entry.vatLines[0].debit).toBe(0);
      expect(entry.vatLines[0].credit).toBe(700);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingClosingService } from './closing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { YearEndClosingTemplate } from '../journal/cpa-templates/year-end-closing.template';

/**
 * Year-end Closing service tests.
 *
 * Tests the orchestration logic only — JE math is owned by
 * YearEndClosingTemplate (separate spec). Focus here:
 *  - year window validation (no future / current-year closes)
 *  - period-closure gate (ต้องปิดงวดทุกเดือนก่อน)
 *  - idempotency (a year closed twice → ConflictException)
 *  - audit log emission with proper shape
 *  - OWNER-only reverse + 10-char reason guard
 *  - reverse mirror: 3 JEs flipped Dr/Cr
 */
describe('AccountingClosingService', () => {
  let service: AccountingClosingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let template: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journalAuto: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

  // year in the past — services reject current/future year
  const PAST_YEAR = new Date().getFullYear() - 1;

  beforeEach(async () => {
    prisma = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'finance-co-1' }),
      },
      accountingPeriod: {
        findMany: jest.fn().mockResolvedValue(
          // all 12 months CLOSED by default
          Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            status: 'CLOSED',
          })),
        ),
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn);
      }),
    };

    template = {
      getYearAccountActivity: jest.fn().mockResolvedValue({
        revenues: [
          { code: '41-1101', name: 'รายได้ดอกเบี้ย', balance: new Prisma.Decimal('100000.00') },
          { code: '42-1102', name: 'ดอกเบี้ยเงินฝาก', balance: new Prisma.Decimal('5000.00') },
        ],
        expenses: [
          { code: '51-1102', name: 'หนี้สูญ', balance: new Prisma.Decimal('20000.00') },
        ],
        revenueTotal: new Prisma.Decimal('105000.00'),
        expenseTotal: new Prisma.Decimal('20000.00'),
        netIncome: new Prisma.Decimal('85000.00'),
      }),
      execute: jest.fn().mockResolvedValue({
        batchId: 'batch-uuid-1',
        step1: { entryNo: 'JE-202612-00001', journalEntryId: 'je-1' },
        step2: { entryNo: 'JE-202612-00002', journalEntryId: 'je-2' },
        step3: { entryNo: 'JE-202612-00003', journalEntryId: 'je-3' },
        netIncome: new Prisma.Decimal('85000.00'),
        revenueTotal: new Prisma.Decimal('105000.00'),
        expenseTotal: new Prisma.Decimal('20000.00'),
      }),
    };

    journalAuto = {
      createAndPost: jest.fn().mockImplementation(async () => ({
        id: 'je-reverse-1',
        entryNumber: 'JE-202605-00099',
      })),
    };

    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountingClosingService,
        { provide: PrismaService, useValue: prisma },
        { provide: YearEndClosingTemplate, useValue: template },
        { provide: JournalAutoService, useValue: journalAuto },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<AccountingClosingService>(AccountingClosingService);
  });

  // ─── previewYearEndClosing ─────────────────────────────────────────────

  describe('previewYearEndClosing', () => {
    it('returns revenue/expense rows + netIncome summary', async () => {
      const out = await service.previewYearEndClosing(PAST_YEAR);
      expect(out.year).toBe(PAST_YEAR);
      expect(out.revenues).toHaveLength(2);
      expect(out.revenues[0]).toEqual({
        code: '41-1101',
        name: 'รายได้ดอกเบี้ย',
        balance: '100000.00',
      });
      expect(out.expenses).toHaveLength(1);
      expect(out.netIncome).toBe('85000.00');
      expect(out.isProfit).toBe(true);
      expect(out.totalSteps).toBe(3);
      expect(out.alreadyClosed).toBe(false);
      expect(out.openMonths).toEqual([]);
    });

    it('rejects future year', async () => {
      const futureYear = new Date().getFullYear() + 1;
      await expect(service.previewYearEndClosing(futureYear)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects current year', async () => {
      const currentYear = new Date().getFullYear();
      await expect(service.previewYearEndClosing(currentYear)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reports openMonths when some periods are not CLOSED/SYNCED', async () => {
      prisma.accountingPeriod.findMany.mockResolvedValueOnce([
        { month: 1, status: 'CLOSED' },
        { month: 2, status: 'OPEN' }, // problem
        { month: 3, status: 'CLOSED' },
        // months 4-12 missing → also flagged as OPEN
      ]);
      const out = await service.previewYearEndClosing(PAST_YEAR);
      expect(out.openMonths.length).toBeGreaterThan(0);
      expect(out.openMonths.some((p: { month: number }) => p.month === 2)).toBe(true);
    });

    it('flags alreadyClosed=true when a YEAR_END_CLOSING JE already exists', async () => {
      prisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'existing-je',
        entryDate: new Date('2026-12-31T16:59:59.999Z'),
        metadata: { batchId: 'old-batch' },
      });
      const out = await service.previewYearEndClosing(PAST_YEAR);
      expect(out.alreadyClosed).toBe(true);
      expect(out.closingBatchId).toBe('old-batch');
    });

    it('totalSteps=2 when netIncome is effectively zero', async () => {
      template.getYearAccountActivity.mockResolvedValueOnce({
        revenues: [{ code: '41-1101', name: 'x', balance: new Prisma.Decimal('100') }],
        expenses: [{ code: '51-1102', name: 'y', balance: new Prisma.Decimal('100') }],
        revenueTotal: new Prisma.Decimal('100'),
        expenseTotal: new Prisma.Decimal('100'),
        netIncome: new Prisma.Decimal('0'),
      });
      const out = await service.previewYearEndClosing(PAST_YEAR);
      expect(out.totalSteps).toBe(2);
    });
  });

  // ─── postYearEndClosing ───────────────────────────────────────────────

  describe('postYearEndClosing', () => {
    it('posts 3 JEs and emits YEAR_END_CLOSED audit log', async () => {
      const out = await service.postYearEndClosing(PAST_YEAR, 'user-owner-1');
      expect(out.batchId).toBe('batch-uuid-1');
      expect(out.step1.entryNo).toBe('JE-202612-00001');
      expect(out.step3?.entryNo).toBe('JE-202612-00003');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-owner-1',
          action: 'YEAR_END_CLOSED',
          entity: 'accounting_period',
          entityId: 'batch-uuid-1',
          newValue: expect.objectContaining({
            year: PAST_YEAR,
            netIncome: '85000.00',
          }),
        }),
      );
    });

    it('rejects if any monthly period is still OPEN', async () => {
      prisma.accountingPeriod.findMany.mockResolvedValueOnce([
        { month: 1, status: 'OPEN' },
        ...Array.from({ length: 11 }, (_, i) => ({ month: i + 2, status: 'CLOSED' })),
      ]);
      await expect(
        service.postYearEndClosing(PAST_YEAR, 'user-owner-1'),
      ).rejects.toThrow(BadRequestException);
      expect(template.execute).not.toHaveBeenCalled();
    });

    it('rejects if year is already closed (idempotency)', async () => {
      prisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'existing-je',
        entryDate: new Date(),
        metadata: { batchId: 'old' },
      });
      await expect(
        service.postYearEndClosing(PAST_YEAR, 'user-owner-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects future year before any DB work', async () => {
      const fut = new Date().getFullYear() + 5;
      await expect(service.postYearEndClosing(fut, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(template.execute).not.toHaveBeenCalled();
    });

    it('treats a reversed prior batch as not-blocking (allows re-close)', async () => {
      // First findFirst (pre-tx) returns a reversed batch — must NOT block
      prisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'old-je',
        entryDate: new Date(),
        metadata: { batchId: 'old', reversedByBatchId: 'old:R' },
      });
      // Inside-tx findFirst → none active
      prisma.journalEntry.findFirst.mockResolvedValueOnce(null);
      const out = await service.postYearEndClosing(PAST_YEAR, 'user-1');
      expect(out.batchId).toBe('batch-uuid-1');
    });
  });

  // ─── reverseYearEndClosing ────────────────────────────────────────────

  describe('reverseYearEndClosing', () => {
    const buildBatchEntries = () => [
      {
        id: 'je-1',
        description: 'ปิดบัญชีรายได้',
        entryDate: new Date(),
        metadata: { flow: 'year-end-closing', year: PAST_YEAR, step: 1, batchId: 'b1' },
        lines: [
          { accountCode: '41-1101', debit: new Prisma.Decimal('100000'), credit: new Prisma.Decimal('0'), description: 'x' },
          { accountCode: '39-9999', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('100000'), description: 'y' },
        ],
      },
      {
        id: 'je-2',
        description: 'ปิดบัญชีค่าใช้จ่าย',
        entryDate: new Date(),
        metadata: { flow: 'year-end-closing', year: PAST_YEAR, step: 2, batchId: 'b1' },
        lines: [
          { accountCode: '39-9999', debit: new Prisma.Decimal('20000'), credit: new Prisma.Decimal('0'), description: 'x' },
          { accountCode: '51-1102', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('20000'), description: 'y' },
        ],
      },
      {
        id: 'je-3',
        description: 'โอนกำไรสุทธิเข้ากำไรสะสม',
        entryDate: new Date(),
        metadata: { flow: 'year-end-closing', year: PAST_YEAR, step: 3, batchId: 'b1' },
        lines: [
          { accountCode: '39-9999', debit: new Prisma.Decimal('80000'), credit: new Prisma.Decimal('0'), description: 'x' },
          { accountCode: '33-1101', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('80000'), description: 'y' },
        ],
      },
    ];

    it('reverses all 3 JEs and writes YEAR_END_CLOSING_REVERSED audit', async () => {
      prisma.journalEntry.findMany.mockResolvedValue(buildBatchEntries());
      const out = await service.reverseYearEndClosing(
        PAST_YEAR,
        'owner-1',
        'พบข้อผิดพลาดในบัญชีค่าใช้จ่าย ต้องกลับรายการ',
        'OWNER',
      );
      expect(out.originalBatchId).toBe('b1');
      expect(out.reverseBatchId).toBe('b1:R');
      expect(out.entries).toHaveLength(3);
      expect(journalAuto.createAndPost).toHaveBeenCalledTimes(3);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'YEAR_END_CLOSING_REVERSED',
          userId: 'owner-1',
        }),
      );
    });

    it('rejects non-OWNER roles', async () => {
      prisma.journalEntry.findMany.mockResolvedValue(buildBatchEntries());
      await expect(
        service.reverseYearEndClosing(
          PAST_YEAR,
          'acc-1',
          'ขอกลับรายการเพื่อทดสอบระบบ',
          'ACCOUNTANT',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects reason shorter than 10 characters', async () => {
      await expect(
        service.reverseYearEndClosing(PAST_YEAR, 'owner-1', 'สั้น', 'OWNER'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when no closing exists for the year', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([]);
      await expect(
        service.reverseYearEndClosing(
          PAST_YEAR,
          'owner-1',
          'พยายามกลับรายการที่ไม่เคยทำ',
          'OWNER',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when prior batch was already reversed', async () => {
      const reversed = buildBatchEntries().map((e) => ({
        ...e,
        metadata: { ...e.metadata, reversedByBatchId: 'b1:R' },
      }));
      prisma.journalEntry.findMany.mockResolvedValue(reversed);
      await expect(
        service.reverseYearEndClosing(
          PAST_YEAR,
          'owner-1',
          'ปีนี้ถูกกลับรายการไปแล้ว ลองอีกครั้ง',
          'OWNER',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('flips Dr/Cr in the reverse JE lines (mirror)', async () => {
      prisma.journalEntry.findMany.mockResolvedValue(buildBatchEntries());
      await service.reverseYearEndClosing(
        PAST_YEAR,
        'owner-1',
        'ทดสอบ flip Dr/Cr ในกระบวนการ reverse',
        'OWNER',
      );
      // Inspect the first createAndPost call (corresponds to step1 reverse)
      const firstCall = journalAuto.createAndPost.mock.calls[0][0];
      const origRevenueLine = firstCall.lines.find((l: { accountCode: string }) => l.accountCode === '41-1101');
      // Original had Dr 100000 — reverse should have Cr 100000
      expect(origRevenueLine.cr.toString()).toBe('100000');
      expect(origRevenueLine.dr.toString()).toBe('0');
    });
  });
});

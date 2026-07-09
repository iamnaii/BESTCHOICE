/**
 * payments.preview-journal-money.spec.ts
 *
 * Characterization (golden) tests — Wave 3 gap-fill (audit HIGH gap).
 *
 * PINs the CURRENT JE-line output of PaymentsService.previewJournal
 * (payments.service.ts ~1742-2042) plus the recordPayment tolerance-gating
 * boundaries (~287-337). The service source is NOT modified — surprising/quirky
 * behaviour is encoded as the golden value, not "fixed".
 *
 * Bands / branches locked by this file:
 *
 *   previewJournal:
 *     1. ≤1฿ rounding tolerance (lines 1992-2008):
 *        - overpay  +0.50 → Cr 53-1503 = 0.50  (adj_overpay fallback when
 *                            accountRoleService is undefined)
 *        - underpay -0.50 → Dr 52-1104 = 0.50  (adj_underpay fallback)
 *        - roundingDiff == 1.00 → STILL routes (lte tolerance, inclusive)
 *        - roundingDiff == 1.01 → does NOT route (no adj line)
 *        - JE balanced in every routed case
 *     2. RESCHEDULE 6a/6b (lines 1821-1880):
 *        - monthly 2202.41, days 11 → fee = 2202.41/30*11 = 807.5503 → 808 (ROUND_UP whole baht)
 *        - 6b bundled: Dr deposit 3010.41 / Cr 11-2103 2202.41 / Cr 21-1103 808.00
 *        - 6a split:   Cr 21-1103 808.00 only (fee advance)
 *        - days 0 → fee 0.00 (6b still emits a zero 21-1103 line)
 *     3. CONSOLIDATED 2A+2B breakdown (lines 1781-1794, 1965-1977):
 *        - vatAmount 1729, interest 6000, months 12, monthly 2202.41 →
 *          vatPerInst 144.08 / interestPerInst 500.00 / installmentExclVat 2058.33
 *        - fallback vatAmount=null → vatPerInst = round(monthly/1.07*0.07, HALF_UP)
 *     4. Advance split (lines 1936-1987):
 *        - advanceBalance 300, underpay by 100 (NORMAL) → Dr 21-1103 = 100
 *          (min(300,100)); rounding line suppressed; JE balanced
 *        - OVERPAY_ADVANCE +50 → Cr 21-1103 = 50; NO 53-1503 line
 *
 *   recordPayment tolerance gating (lines 287-337):
 *     - overage == 1.00 records (no case needed); == 1.01 throws (OVERPAY_ADVANCE)
 *     - shortage == 1.00 records;                  == 1.01 throws (PARTIAL)
 *
 * Money is Prisma.Decimal in production. previewJournal uses Prisma.Decimal
 * arithmetic throughout (.plus/.minus/.div/.times/.toFixed), so all monetary
 * inputs are passed as real Prisma.Decimal values; assertions compare the
 * .toFixed(2) strings the service emits.
 *
 * previewJournal touches prisma.installmentSchedule.findUnique (with
 * `include: { contract: true }`), prisma.chartOfAccount.findMany, and (T1, in the
 * 2B_ONLY path) prisma.journalEntry.findFirst to fetch the posted 2A accrual
 * context — a hand-mocked PrismaService covers all three with no DB. recordPayment
 * reuses the proven
 * advance/late-fee harness ($transaction(cb => cb(tx))). accountRoleService is
 * left undefined to lock the FALLBACK codes (52-1104 / 53-1503).
 */

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  SentryModule: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { AuditService } from '../audit/audit.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { PromiseService } from '../overdue/promise.service';
import { MdmLockService } from '../overdue/mdm-lock.service';
import { PaymentReceiptTemplate } from '../journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { BadDebtService } from '../accounting/bad-debt.service';

const D = (n: number | string): Prisma.Decimal => new Prisma.Decimal(n);

type JeLine = {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
};

/** Find a single JE line by account code (undefined if absent). */
const lineFor = (lines: JeLine[], code: string): JeLine | undefined =>
  lines.find((l) => l.accountCode === code);

/**
 * Contract shape consumed by previewJournal. Only the fields the method reads
 * are populated; money fields are Prisma.Decimal to mirror production.
 */
type ContractStub = {
  totalMonths: number;
  interestTotal: Prisma.Decimal | null;
  monthlyPayment: Prisma.Decimal | null;
  vatAmount: Prisma.Decimal | null;
  advanceBalance: Prisma.Decimal | null;
};

type InstallmentStub = {
  accrualJournalEntryId: string | null;
  dueDate: Date;
  contract: ContractStub;
};

describe('PaymentsService.previewJournal (characterization)', () => {
  let service: PaymentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  // Per-test installment returned by installmentSchedule.findUnique.
  let installment: InstallmentStub;

  const baseContract = (overrides: Partial<ContractStub> = {}): ContractStub => ({
    totalMonths: 12,
    interestTotal: D(6000),
    monthlyPayment: D(2000),
    vatAmount: D(0),
    advanceBalance: D(0),
    ...overrides,
  });

  const baseInstallment = (overrides: Partial<InstallmentStub> = {}): InstallmentStub => ({
    // accrualJournalEntryId set → 2B-ONLY path (single Cr 11-2103 clear).
    accrualJournalEntryId: 'je-accrual-1',
    dueDate: new Date('2027-01-15'),
    contract: baseContract(),
    ...overrides,
  });

  beforeEach(async () => {
    installment = baseInstallment();

    prisma = {
      installmentSchedule: {
        // Lazy-gen recovery (#1170): count>0 → ensureInstallmentSchedules no-op.
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(installment)),
      },
      chartOfAccount: {
        // Names are irrelevant to the money assertions — return [] so the
        // service falls back to `nameMap.get(code) ?? code` (accountName = code).
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalEntry: {
        // T1: 2B_ONLY preview fetches posted 2A accrual + advance-consume JEs.
        // [] → no 2A block (accrual2A undefined); the live 2B money lines +
        // totals are unchanged, so these characterization assertions still hold.
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const noopAudit = {
      log: jest.fn(),
      logPaymentEvent: jest.fn(),
      logReceiptEvent: jest.fn(),
      logContractFinancialEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReceiptsService, useValue: { generateReceipt: jest.fn() } },
        { provide: AuditService, useValue: noopAudit },
        { provide: JournalAutoService, useValue: {} },
        { provide: ProductsService, useValue: {} },
        { provide: LineOaService, useValue: {} },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
        { provide: PromiseService, useValue: {} },
        { provide: MdmLockService, useValue: {} },
        { provide: PaymentReceiptTemplate, useValue: { execute: jest.fn() } },
        { provide: Vat60dayReversalTemplate, useValue: { execute: jest.fn() } },
        { provide: BadDebtService, useValue: {} },
        // accountRoleService intentionally NOT provided (@Optional) — locks the
        // fallback adj codes 52-1104 / 53-1503.
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Gap 1 — ≤1฿ rounding tolerance (fallback adj codes)
  // ───────────────────────────────────────────────────────────────────────────
  describe('≤1฿ rounding tolerance', () => {
    it('overpay by 0.50 → Cr 53-1503 = 0.50 (adj_overpay fallback) and JE balanced', async () => {
      // monthly 2000, 2B-only. amountReceived 2000.50 → roundingDiff +0.50.
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 2000.5,
        depositAccountCode: '11-1101',
      });

      const adj = lineFor(out.lines, '53-1503');
      expect(adj).toBeDefined();
      expect(adj?.credit).toBe('0.50');
      expect(adj?.debit).toBe('0.00');
      // Cash 2000.50 ; Cr 11-2103 2000.00 + Cr 53-1503 0.50 = 2000.50.
      expect(out.totalDebit).toBe('2000.50');
      expect(out.totalCredit).toBe('2000.50');
      expect(out.isBalanced).toBe(true);
    });

    it('underpay by 0.50 → Dr 52-1104 = 0.50 (adj_underpay fallback) and JE balanced', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 1999.5,
        depositAccountCode: '11-1101',
      });

      const adj = lineFor(out.lines, '52-1104');
      expect(adj).toBeDefined();
      expect(adj?.debit).toBe('0.50');
      expect(adj?.credit).toBe('0.00');
      // Cash 1999.50 + Dr 52-1104 0.50 = 2000.00 ; Cr 11-2103 2000.00.
      expect(out.totalDebit).toBe('2000.00');
      expect(out.totalCredit).toBe('2000.00');
      expect(out.isBalanced).toBe(true);
    });

    it('roundingDiff == 1.00 STILL routes (lte tolerance is inclusive)', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 2001, // +1.00 exactly
        depositAccountCode: '11-1101',
      });

      const adj = lineFor(out.lines, '53-1503');
      expect(adj?.credit).toBe('1.00');
      expect(out.isBalanced).toBe(true);
    });

    it('roundingDiff == 1.01 does NOT route (no adjustment line; JE left unbalanced)', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 2001.01, // +1.01 — over tolerance
        depositAccountCode: '11-1101',
      });

      expect(lineFor(out.lines, '53-1503')).toBeUndefined();
      expect(lineFor(out.lines, '52-1104')).toBeUndefined();
      // QUIRK: with no adj line the preview JE is intentionally NOT balanced.
      expect(out.totalDebit).toBe('2001.01');
      expect(out.totalCredit).toBe('2000.00');
      expect(out.isBalanced).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P2 (D1): gross late-fee waiver — preview mirrors the save (Dr 52-1105 + Cr 42-1103 gross)
  // ───────────────────────────────────────────────────────────────────────────
  describe('gross late-fee waiver (P2)', () => {
    it('lateFee 100, waive 40 → Cr 42-1103 = 100 (gross), Dr 52-1105 = 40, balanced', async () => {
      // monthly 2000, 2B-only. net late fee = 60 → cash = 2000 + 60 = 2060.
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 2060,
        depositAccountCode: '11-1101',
        lateFee: 100,
        lateFeeWaived: 40,
      });

      expect(lineFor(out.lines, '42-1103')?.credit).toBe('100.00'); // GROSS recognised
      expect(lineFor(out.lines, '52-1105')?.debit).toBe('40.00'); // waived discount
      expect(lineFor(out.lines, '11-2103')?.credit).toBe('2000.00');
      expect(lineFor(out.lines, '11-1101')?.debit).toBe('2060.00');
      // Dr 2060 + 40 = 2100 ; Cr 2000 + 100 = 2100.
      expect(out.totalDebit).toBe('2100.00');
      expect(out.totalCredit).toBe('2100.00');
      expect(out.isBalanced).toBe(true);
    });

    it('no waiver (lateFeeWaived omitted) → no 52-1105 line; Cr 42-1103 = full late fee', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 2100, // 2000 + full late fee 100
        depositAccountCode: '11-1101',
        lateFee: 100,
      });
      expect(lineFor(out.lines, '52-1105')).toBeUndefined();
      expect(lineFor(out.lines, '42-1103')?.credit).toBe('100.00');
      expect(out.isBalanced).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Gap 2 — RESCHEDULE 6a / 6b (JP6 preview)
  // ───────────────────────────────────────────────────────────────────────────
  describe('RESCHEDULE 6a/6b', () => {
    beforeEach(() => {
      // RESCHEDULE requires accrual present (else throws at ~1812). monthly 2202.41.
      installment = baseInstallment({
        accrualJournalEntryId: 'je-accrual-resch',
        contract: baseContract({ monthlyPayment: D(2202.41) }),
      });
    });

    // ปรับดิว collect-first (2026-07-02): the RESCHEDULE preview now shows the
    // JE that posts AT CONFIRM — 6a: Dr deposit (fee+ค่าปรับ) / Cr 21-1103 fee /
    // Cr 42-1103 ค่าปรับ; 6b: ค่าปรับ only. The old bundled-6b preview
    // (Dr cash monthly+fee / Cr 11-2103) represented a FUTURE payment and is gone.
    it('6b (SINGLE) with no late fee → nothing to collect, NO lines', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 0,
        depositAccountCode: '11-1101',
        case: 'RESCHEDULE',
        daysToShift: 11,
        splitMode: 'SINGLE',
      });

      // 2202.41 / 30 * 11 = 807.5503... → ROUND_UP to whole baht → 808
      expect(out.rescheduleFeeDisplay).toBe('808.00');
      expect(out.lines).toHaveLength(0);
      expect(out.isBalanced).toBe(true);
    });

    it('6b (SINGLE) with late fee 100 → Dr deposit 100 / Cr 42-1103 100 only', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 100,
        depositAccountCode: '11-1101',
        case: 'RESCHEDULE',
        daysToShift: 11,
        splitMode: 'SINGLE',
        lateFee: 100,
      });

      expect(out.rescheduleFeeDisplay).toBe('808.00');
      expect(lineFor(out.lines, '11-1101')?.debit).toBe('100.00');
      expect(lineFor(out.lines, '42-1103')?.credit).toBe('100.00');
      expect(lineFor(out.lines, '21-1103')).toBeUndefined();
      expect(lineFor(out.lines, '11-2103')).toBeUndefined();
      expect(out.isBalanced).toBe(true);
    });

    it('6a (SPLIT) with late fee 100 → Dr deposit 908 / Cr 21-1103 808 / Cr 42-1103 100', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 908,
        depositAccountCode: '11-1101',
        case: 'RESCHEDULE',
        daysToShift: 11,
        splitMode: 'SPLIT',
        lateFee: 100,
      });

      expect(out.rescheduleFeeDisplay).toBe('808.00');
      expect(lineFor(out.lines, '11-1101')?.debit).toBe('908.00');
      expect(lineFor(out.lines, '21-1103')?.credit).toBe('808.00');
      expect(lineFor(out.lines, '42-1103')?.credit).toBe('100.00');
      expect(lineFor(out.lines, '11-2103')).toBeUndefined();
      expect(out.isBalanced).toBe(true);
    });

    it('6a (SPLIT) no late fee: only the fee advance posts (Cr 21-1103 = 808.00), no 11-2103 line', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 808.0,
        depositAccountCode: '11-1101',
        case: 'RESCHEDULE',
        daysToShift: 11,
        splitMode: 'SPLIT',
      });

      expect(out.rescheduleFeeDisplay).toBe('808.00');
      expect(lineFor(out.lines, '11-1101')?.debit).toBe('808.00');
      expect(lineFor(out.lines, '21-1103')?.credit).toBe('808.00');
      expect(lineFor(out.lines, '11-2103')).toBeUndefined();
      expect(out.isBalanced).toBe(true);
    });

    it('daysToShift 0 → fee 0.00, nothing to collect, NO lines', async () => {
      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 0,
        depositAccountCode: '11-1101',
        case: 'RESCHEDULE',
        daysToShift: 0,
        splitMode: 'SINGLE',
      });

      expect(out.rescheduleFeeDisplay).toBe('0.00');
      expect(out.lines).toHaveLength(0);
      expect(out.isBalanced).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Gap 3 — non-accrued installment: preview mirrors the save (QA #1347 follow-up)
  // The old CONSOLIDATED 2A+2B line-breakdown predates PR-843/I2; the save now
  // ALWAYS credits 11-2103 and the nightly 2A cron backfills the accrual, so
  // the preview emits the same single receivable-clearing line. Only the
  // accrualMode chip still distinguishes PAYING_AHEAD / BACKFILL / 2B_ONLY.
  // ───────────────────────────────────────────────────────────────────────────
  describe('non-accrued installment (preview mirrors the save)', () => {
    it('explicit vatAmount: live lines = Dr cash / Cr 11-2103 (no consolidated legs), mode PAYING_AHEAD', async () => {
      installment = baseInstallment({
        accrualJournalEntryId: null,
        dueDate: new Date('2099-01-01'), // future → CONSOLIDATED_PAYING_AHEAD
        contract: baseContract({
          monthlyPayment: D(2202.41),
          interestTotal: D(6000),
          vatAmount: D(1729),
          totalMonths: 12,
        }),
      });

      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 2202.41,
        depositAccountCode: '11-1101',
      });

      expect(lineFor(out.lines, '11-1101')?.debit).toBe('2202.41');
      expect(lineFor(out.lines, '11-2103')?.credit).toBe('2202.41');
      // Consolidated legs never post since PR-843/I2 — must not be previewed
      for (const code of ['21-2102', '11-2105', '21-2101', '11-2106', '41-1101', '11-2101']) {
        expect(lineFor(out.lines, code)).toBeUndefined();
      }
      expect(out.accrualMode).toBe('CONSOLIDATED_PAYING_AHEAD');
      expect(out.isBalanced).toBe(true);
    });

    it('vatAmount=null fallback contract: same mirror — Cr 11-2103 = monthlyPayment', async () => {
      installment = baseInstallment({
        accrualJournalEntryId: null,
        dueDate: new Date('2099-01-01'),
        contract: baseContract({
          monthlyPayment: D(1070),
          interestTotal: D(6000),
          vatAmount: null,
          totalMonths: 12,
        }),
      });

      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 1070,
        depositAccountCode: '11-1101',
      });

      expect(lineFor(out.lines, '11-2103')?.credit).toBe('1070.00');
      expect(lineFor(out.lines, '11-2101')).toBeUndefined();
      expect(lineFor(out.lines, '41-1101')).toBeUndefined();
      expect(out.isBalanced).toBe(true);
    });

    it('past dueDate with missing 2A → accrualMode CONSOLIDATED_BACKFILL', async () => {
      installment = baseInstallment({
        accrualJournalEntryId: null,
        dueDate: new Date('2000-01-01'), // past → BACKFILL
        contract: baseContract({ monthlyPayment: D(1070), vatAmount: null }),
      });

      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 1070,
        depositAccountCode: '11-1101',
      });

      expect(out.accrualMode).toBe('CONSOLIDATED_BACKFILL');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Gap 4 — advance split
  // ───────────────────────────────────────────────────────────────────────────
  describe('advance split', () => {
    it('advanceBalance 300, underpay by 100 (NORMAL) → Dr 21-1103 = 100 (min), rounding suppressed, balanced', async () => {
      installment = baseInstallment({
        contract: baseContract({ monthlyPayment: D(2000), advanceBalance: D(300) }),
      });

      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 1900, // 100 short of 2000
        depositAccountCode: '11-1101',
        case: 'NORMAL',
      });

      // previewAdvConsume = min(300, 100) = 100 → Dr 21-1103
      expect(lineFor(out.lines, '21-1103')?.debit).toBe('100.00');
      // rounding adj suppressed (previewAdvConsume != 0): no 52-1104.
      expect(lineFor(out.lines, '52-1104')).toBeUndefined();
      // Cash 1900 + Dr 21-1103 100 = 2000 ; Cr 11-2103 2000.
      expect(out.totalDebit).toBe('2000.00');
      expect(out.totalCredit).toBe('2000.00');
      expect(out.isBalanced).toBe(true);
    });

    it('OVERPAY_ADVANCE +50 → Cr 21-1103 = 50, NO 53-1503 line, balanced', async () => {
      installment = baseInstallment({
        contract: baseContract({ monthlyPayment: D(2000), advanceBalance: D(0) }),
      });

      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 1,
        amountReceived: 2050, // 50 over
        depositAccountCode: '11-1101',
        case: 'OVERPAY_ADVANCE',
      });

      expect(lineFor(out.lines, '21-1103')?.credit).toBe('50.00');
      // rounding adj suppressed (previewAdvCredit != 0): no 53-1503.
      expect(lineFor(out.lines, '53-1503')).toBeUndefined();
      // Cash 2050 ; Cr 11-2103 2000 + Cr 21-1103 50 = 2050.
      expect(out.totalDebit).toBe('2050.00');
      expect(out.totalCredit).toBe('2050.00');
      expect(out.isBalanced).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordPayment tolerance gating (lines 287-337)
// Reuses the proven advance/late-fee harness ($transaction(cb => cb(tx))).
// ─────────────────────────────────────────────────────────────────────────────
describe('PaymentsService.recordPayment — tolerance gating (characterization)', () => {
  let service: PaymentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  // installmentTotal (remaining when prevPaid=0, lateFee=0) is amountDue.
  const REMAINING = 1000;

  const makeContract = () => ({
    id: 'tol-contract-1',
    contractNumber: 'BC-TOL-001',
    status: 'ACTIVE',
    deletedAt: null,
    branchId: 'branch-1',
    customerId: 'cust-1',
    advanceBalance: D(0),
  });

  const makePayment = () => ({
    id: 'tol-payment-1',
    contractId: 'tol-contract-1',
    installmentNo: 1,
    amountDue: D(REMAINING),
    amountPaid: D(0),
    lateFee: D(0),
    lateFeeWaived: false,
    dueDate: new Date('2027-01-01'), // future → no real-time late fee
    status: 'PENDING',
    evidenceUrl: null,
    notes: null,
    depositAccountCode: null,
  });

  beforeEach(async () => {
    const buildMockPrisma = () => ({
      contract: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(makeContract())),
        update: jest.fn().mockResolvedValue(makeContract()),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(makePayment()),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({
              id: 'tol-payment-1',
              contractId: 'tol-contract-1',
              installmentNo: 1,
              amountDue: D(REMAINING),
              amountPaid: data.amountPaid ?? D(0),
              lateFee: data.lateFee ?? D(0),
              status: data.status ?? 'PENDING',
              paidDate: data.paidDate ?? null,
              depositAccountCode: data.depositAccountCode ?? null,
            }),
          ),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: REMAINING, lateFee: 0 } }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', defaultCashAccountCode: null, deletedAt: null }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      installmentSchedule: {
        // Lazy-gen recovery (#1170): count>0 → ensureInstallmentSchedules no-op.
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null), // template call skipped
      },
      callLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      partialPaymentLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'al-1' }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrismaInst)),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockPrismaInst: any = buildMockPrisma();
    prisma = mockPrismaInst;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReceiptsService, useValue: { generateReceipt: jest.fn().mockResolvedValue({ id: 'r-1' }) } },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
            logPaymentEvent: jest.fn().mockResolvedValue(undefined),
            logReceiptEvent: jest.fn().mockResolvedValue(undefined),
            logContractFinancialEvent: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: JournalAutoService, useValue: { createPaymentJournal: jest.fn().mockResolvedValue('je-1') } },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn() } },
        {
          provide: LineOaService,
          useValue: { buildPaymentSuccess: jest.fn().mockReturnValue({}), sendFlexMessage: jest.fn() },
        },
        {
          provide: FlexTemplatesService,
          useValue: { paymentReceipt: jest.fn().mockReturnValue({ type: 'flex', altText: 't', contents: {} }) },
        },
        { provide: QuickReplyService, useValue: { afterPayment: jest.fn().mockReturnValue([]) } },
        { provide: PromiseService, useValue: { findActivePromise: jest.fn().mockResolvedValue(null) } },
        { provide: MdmLockService, useValue: { autoUnlock: jest.fn().mockResolvedValue(undefined) } },
        { provide: PaymentReceiptTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE', split: { principalRemainingAfter: 0 } }) } },
        { provide: Vat60dayReversalTemplate, useValue: { execute: jest.fn().mockResolvedValue(null) } },
        { provide: BadDebtService, useValue: { reverseStageOnPayment: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('overage == 1.00 records without a case (gt 1.00 is exclusive)', async () => {
    const result = await service.recordPayment(
      'tol-contract-1',
      1,
      REMAINING + 1.0, // 1001 → overage 1.00
      'CASH',
      'user-1',
      'https://slip.test/over-100',
    );

    expect(prisma.payment.update).toHaveBeenCalled();
    expect(result.status).toBe('PAID');
  });

  it('overage above the auto-advance ceiling throws BadRequest mentioning OVERPAY_ADVANCE', async () => {
    // D1 (owner 2026-06-25): overpay within multiplier×amountDue (default 2 →
    // ceiling 2000) auto-routes to advance (Cr 21-1103) WITHOUT throwing. Only
    // overage ABOVE the ceiling still requires an explicit OVERPAY_ADVANCE case.
    // amountDue=1000 → ceiling=2000, so overage 2000.01 must throw. (Was overage
    // 1.01, which now legitimately auto-advances → no throw.)
    await expect(
      service.recordPayment(
        'tol-contract-1',
        1,
        REMAINING + 2000.01, // 3000.01 → overage 2000.01 > ceiling 2000
        'CASH',
        'user-1',
        'https://slip.test/over-ceiling',
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.recordPayment(
        'tol-contract-1',
        1,
        REMAINING + 2000.01,
        'CASH',
        'user-1',
        'https://slip.test/over-ceiling-b',
      ),
    ).rejects.toThrow(/OVERPAY_ADVANCE/);
  });

  it('shortage == 1.00 records without a case (gt 1.00 is exclusive)', async () => {
    const result = await service.recordPayment(
      'tol-contract-1',
      1,
      REMAINING - 1.0, // 999 → shortage 1.00
      'CASH',
      'user-1',
      'https://slip.test/short-100',
    );

    expect(prisma.payment.update).toHaveBeenCalled();
    // shortage 1.00 is NOT a partial clear; recordedAmountPaid 999 < amountDue 1000.
    expect(result.status).toBe('PARTIALLY_PAID');
  });

  it('shortage == 1.01 throws BadRequest mentioning PARTIAL', async () => {
    await expect(
      service.recordPayment(
        'tol-contract-1',
        1,
        REMAINING - 1.01, // 998.99 → shortage 1.01
        'CASH',
        'user-1',
        'https://slip.test/short-101',
      ),
    ).rejects.toThrow(/PARTIAL/);
  });
});

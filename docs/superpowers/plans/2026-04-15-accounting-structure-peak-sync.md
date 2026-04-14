# Accounting Structure + PEAK Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize the monthly close workflow with an AccountingPeriod model, backfill payment breakdowns on existing data, and create frontend pages for Monthly Close and PEAK Sync management.

**Architecture:** Replace `SystemConfig.accounting_period_closed_until` with a proper `AccountingPeriod` model tracking per-month status (OPEN→REVIEW→CLOSED→SYNCED). Add a `MonthlyCloseService` that orchestrates data audit → report generation → PEAK export → period lock. Frontend pages for close workflow and PEAK sync status.

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, React 19, TanStack Query, Tailwind CSS

**Existing infrastructure (do NOT rebuild):**
- `Payment` model already has `monthlyPrincipal`, `monthlyInterest`, `monthlyCommission`, `vatAmount` (nullable)
- `generatePaymentSchedule()` in `apps/api/src/utils/installment.util.ts` already computes breakdown
- `JournalAutoService` creates correct double-entry journals for 5 event types
- `TaxService` with previewPP30/PND3/PND53, generate, submit
- `PeakService` with exportJournalEntries, HMAC auth, account code mapping
- `AccountingService` with P&L, Balance Sheet, Cash Flow, `validatePeriodOpen()`
- `ChartOfAccount` with `peakAccountCode` + `peakAccountId` mapping
- `CompanyInfo` (SHOP/FINANCE) with `vatRegistered`, `vatRate`
- Period locking via `SystemConfig` key `accounting_period_closed_until`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `apps/api/prisma/migrations/XXXXXX_add_accounting_period/migration.sql` | AccountingPeriod table |
| `apps/api/src/modules/accounting/monthly-close.service.ts` | Monthly close workflow orchestration |
| `apps/api/src/modules/accounting/monthly-close.service.spec.ts` | Tests |
| `apps/api/src/modules/accounting/dto/monthly-close.dto.ts` | DTOs for close actions |
| `apps/web/src/pages/MonthlyClosePage.tsx` | Monthly close workflow UI |
| `apps/web/src/pages/PeakSyncPage.tsx` | PEAK sync status + manual trigger |

### Modified files
| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | Add AccountingPeriod model + enum |
| `apps/api/src/modules/accounting/accounting.module.ts` | Register MonthlyCloseService |
| `apps/api/src/modules/accounting/accounting.controller.ts` | Add monthly close + PEAK sync endpoints |
| `apps/api/src/modules/accounting/accounting.service.ts` | Migrate `validatePeriodOpen()` to use AccountingPeriod model |
| `apps/web/src/App.tsx` | Add routes |

---

## Task 1: AccountingPeriod model + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add AccountingPeriodStatus enum**

Add near other enums:
```prisma
enum AccountingPeriodStatus {
  OPEN
  REVIEW
  CLOSED
  SYNCED
}
```

- [ ] **Step 2: Add AccountingPeriod model**

Add after JournalLine model:
```prisma
model AccountingPeriod {
  id           String                  @id @default(uuid())
  companyId    String                  @map("company_id")
  company      CompanyInfo             @relation(fields: [companyId], references: [id])
  year         Int
  month        Int                     /// 1-12
  status       AccountingPeriodStatus  @default(OPEN)

  // Close workflow
  reviewStartedAt  DateTime?          @map("review_started_at")
  reviewStartedById String?           @map("review_started_by_id")
  reviewStartedBy  User?              @relation("PeriodReviewStartedBy", fields: [reviewStartedById], references: [id])
  closedAt         DateTime?          @map("closed_at")
  closedById       String?            @map("closed_by_id")
  closedBy         User?              @relation("PeriodClosedBy", fields: [closedById], references: [id])

  // PEAK sync
  peakSyncedAt     DateTime?          @map("peak_synced_at")
  peakSyncResult   Json?              @map("peak_sync_result") /// { exported, skipped, errors }

  // Reports snapshot (generated at close time)
  reportSnapshot   Json?              @map("report_snapshot") /// { pl, balanceSheet, trialBalance, vatSummary }

  // Audit
  auditIssues      Json?              @map("audit_issues") /// data audit findings
  notes            String?

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([companyId, year, month])
  @@index([status])
  @@map("accounting_periods")
}
```

- [ ] **Step 3: Add relations**

In `CompanyInfo` model, add:
```prisma
  accountingPeriods AccountingPeriod[]
```

In `User` model, add:
```prisma
  periodsReviewStarted AccountingPeriod[] @relation("PeriodReviewStartedBy")
  periodsClosed        AccountingPeriod[] @relation("PeriodClosedBy")
```

- [ ] **Step 4: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_accounting_period
```

Expected: Migration created, `prisma generate` succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(accounting): add AccountingPeriod model

Per-company monthly period with OPEN→REVIEW→CLOSED→SYNCED workflow,
PEAK sync result tracking, report snapshots, audit findings."
```

---

## Task 2: Backfill migration — populate payment breakdown

**Files:**
- Create: `apps/api/prisma/migrations/XXXXXX_backfill_payment_breakdown/migration.sql`

- [ ] **Step 1: Create backfill migration**

The Payment model already has breakdown fields but existing records may have NULL values. This migration computes breakdown from contract data:

```sql
-- Backfill monthly_principal, monthly_interest, monthly_commission, vat_amount
-- for existing payments that have NULL breakdown fields.
-- Uses contract-level totals divided by total_months with last-installment adjustment.

WITH contract_calc AS (
  SELECT
    c.id AS contract_id,
    c.total_months,
    -- principal per month (rounded to 2dp)
    ROUND((c.financed_amount - COALESCE(
      (SELECT SUM(ic.interest_total) FROM inter_company_transactions ic WHERE ic.contract_id = c.id),
      c.financed_amount * c.interest_rate * c.total_months
    ) - COALESCE(
      (SELECT SUM(ic.commission) FROM inter_company_transactions ic WHERE ic.contract_id = c.id),
      0
    ) - COALESCE(
      (SELECT SUM(ic.vat_amount) FROM inter_company_transactions ic WHERE ic.contract_id = c.id),
      0
    )) / c.total_months, 2) AS monthly_principal,
    -- interest per month
    ROUND(COALESCE(
      (SELECT SUM(ic.interest_total) FROM inter_company_transactions ic WHERE ic.contract_id = c.id),
      c.financed_amount * c.interest_rate * c.total_months
    ) / c.total_months, 2) AS monthly_interest,
    -- commission per month
    ROUND(COALESCE(
      (SELECT SUM(ic.commission) FROM inter_company_transactions ic WHERE ic.contract_id = c.id),
      0
    ) / c.total_months, 2) AS monthly_commission,
    -- total interest
    COALESCE(
      (SELECT SUM(ic.interest_total) FROM inter_company_transactions ic WHERE ic.contract_id = c.id),
      c.financed_amount * c.interest_rate * c.total_months
    ) AS interest_total,
    -- total commission
    COALESCE(
      (SELECT SUM(ic.commission) FROM inter_company_transactions ic WHERE ic.contract_id = c.id),
      0
    ) AS commission_total,
    -- total VAT
    COALESCE(
      (SELECT SUM(ic.vat_amount) FROM inter_company_transactions ic WHERE ic.contract_id = c.id),
      0
    ) AS vat_total
  FROM contracts c
  WHERE c.deleted_at IS NULL
    AND c.status IN ('ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF')
)
UPDATE payments p
SET
  monthly_principal = CASE
    WHEN p.installment_no = cc.total_months
    THEN p.amount_due - cc.monthly_interest - cc.monthly_commission
         - ROUND(cc.vat_total / cc.total_months, 2)
    ELSE cc.monthly_principal
  END,
  monthly_interest = CASE
    WHEN p.installment_no = cc.total_months
    THEN ROUND(cc.interest_total - cc.monthly_interest * (cc.total_months - 1), 2)
    ELSE cc.monthly_interest
  END,
  monthly_commission = CASE
    WHEN p.installment_no = cc.total_months
    THEN ROUND(cc.commission_total - cc.monthly_commission * (cc.total_months - 1), 2)
    ELSE cc.monthly_commission
  END,
  vat_amount = CASE
    WHEN p.installment_no = cc.total_months
    THEN ROUND(cc.vat_total - ROUND(cc.vat_total / cc.total_months, 2) * (cc.total_months - 1), 2)
    ELSE ROUND(cc.vat_total / cc.total_months, 2)
  END
FROM contract_calc cc
WHERE p.contract_id = cc.contract_id
  AND p.monthly_principal IS NULL
  AND cc.total_months > 0;
```

- [ ] **Step 2: Run migration**

```bash
cd apps/api && npx prisma migrate dev --name backfill_payment_breakdown
```

Expected: Migration applied successfully.

- [ ] **Step 3: Verify backfill**

```bash
cd apps/api && npx prisma db execute --stdin <<< "SELECT COUNT(*) AS total, COUNT(monthly_principal) AS with_breakdown FROM payments WHERE contract_id IS NOT NULL;"
```

Expected: `with_breakdown` should equal `total` (or close — cash sales without contracts won't have breakdown).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/migrations/
git commit -m "feat(accounting): backfill payment breakdown (principal/interest/commission/VAT)

Computes per-installment breakdown from contract + inter-company data.
Last installment absorbs rounding differences."
```

---

## Task 3: MonthlyCloseService + tests

**Files:**
- Create: `apps/api/src/modules/accounting/monthly-close.service.ts`
- Create: `apps/api/src/modules/accounting/monthly-close.service.spec.ts`
- Create: `apps/api/src/modules/accounting/dto/monthly-close.dto.ts`

- [ ] **Step 1: Create DTOs**

```typescript
// dto/monthly-close.dto.ts
import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';

export class MonthlyCloseQueryDto {
  @IsInt({ message: 'ปีต้องเป็นจำนวนเต็ม' })
  @Min(2020)
  year: number;

  @IsInt({ message: 'เดือนต้องเป็น 1-12' })
  @Min(1)
  @Max(12)
  month: number;

  @IsString()
  @IsOptional()
  companyId?: string;
}

export class CloseMonthDto {
  @IsInt()
  @Min(2020)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsString()
  companyId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// monthly-close.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MonthlyCloseService } from './monthly-close.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { TaxService } from '../tax/tax.service';
import { PeakService } from '../peak/peak.service';
import { AccountingService } from './accounting.service';
import { BadRequestException } from '@nestjs/common';

describe('MonthlyCloseService', () => {
  let service: MonthlyCloseService;

  const mockPrisma = {
    accountingPeriod: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    journalEntry: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    payment: {
      count: jest.fn(),
    },
  };
  const mockJournalAuto = { getTrialBalance: jest.fn() };
  const mockTax = { previewPP30: jest.fn() };
  const mockPeak = { exportJournalEntries: jest.fn(), isConfigured: jest.fn() };
  const mockAccounting = { getProfitAndLoss: jest.fn(), getBalanceSheet: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlyCloseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JournalAutoService, useValue: mockJournalAuto },
        { provide: TaxService, useValue: mockTax },
        { provide: PeakService, useValue: mockPeak },
        { provide: AccountingService, useValue: mockAccounting },
      ],
    }).compile();

    service = module.get<MonthlyCloseService>(MonthlyCloseService);
    jest.clearAllMocks();
  });

  describe('getPeriodStatus', () => {
    it('should return OPEN for non-existent period', async () => {
      mockPrisma.accountingPeriod.findUnique.mockResolvedValue(null);

      const result = await service.getPeriodStatus('company-1', 2026, 4);

      expect(result.status).toBe('OPEN');
    });

    it('should return existing period data', async () => {
      const period = { id: 'p1', status: 'CLOSED', closedAt: new Date() };
      mockPrisma.accountingPeriod.findUnique.mockResolvedValue(period);

      const result = await service.getPeriodStatus('company-1', 2026, 4);

      expect(result.status).toBe('CLOSED');
    });
  });

  describe('startReview', () => {
    it('should move OPEN period to REVIEW', async () => {
      mockPrisma.accountingPeriod.findUnique.mockResolvedValue(null);
      mockPrisma.accountingPeriod.upsert.mockResolvedValue({ status: 'REVIEW' });
      mockPrisma.journalEntry.count.mockResolvedValue(15);
      mockPrisma.journalEntry.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      const result = await service.startReview('company-1', 2026, 4, 'user-1');

      expect(result.status).toBe('REVIEW');
    });

    it('should reject review on CLOSED period', async () => {
      mockPrisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });

      await expect(service.startReview('company-1', 2026, 4, 'user-1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('closePeriod', () => {
    it('should move REVIEW period to CLOSED with report snapshot', async () => {
      mockPrisma.accountingPeriod.findUnique.mockResolvedValue({ id: 'p1', status: 'REVIEW' });
      mockJournalAuto.getTrialBalance.mockResolvedValue({ accounts: [] });
      mockAccounting.getProfitAndLoss.mockResolvedValue({ revenue: 0, expenses: 0 });
      mockAccounting.getBalanceSheet.mockResolvedValue({ assets: 0, liabilities: 0 });
      mockTax.previewPP30.mockResolvedValue({ totalVatOutput: 0, totalVatInput: 0 });
      mockPrisma.accountingPeriod.update.mockResolvedValue({ status: 'CLOSED' });

      const result = await service.closePeriod('company-1', 2026, 4, 'user-1');

      expect(result.status).toBe('CLOSED');
      expect(mockPrisma.accountingPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CLOSED' }),
        }),
      );
    });

    it('should reject close on OPEN period (must review first)', async () => {
      mockPrisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'OPEN' });

      await expect(service.closePeriod('company-1', 2026, 4, 'user-1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('syncToPeak', () => {
    it('should export journals and mark SYNCED', async () => {
      mockPrisma.accountingPeriod.findUnique.mockResolvedValue({ id: 'p1', status: 'CLOSED' });
      mockPeak.isConfigured.mockReturnValue(true);
      mockPeak.exportJournalEntries.mockResolvedValue({ exported: 10, skipped: 0, errors: [] });
      mockPrisma.accountingPeriod.update.mockResolvedValue({ status: 'SYNCED' });

      const result = await service.syncToPeak('company-1', 2026, 4);

      expect(result.exported).toBe(10);
    });

    it('should reject if PEAK not configured', async () => {
      mockPrisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });
      mockPeak.isConfigured.mockReturnValue(false);

      await expect(service.syncToPeak('company-1', 2026, 4))
        .rejects.toThrow('PEAK ยังไม่ได้ตั้งค่า');
    });
  });

  describe('getPeriodsOverview', () => {
    it('should return 12-month overview', async () => {
      mockPrisma.accountingPeriod.findMany.mockResolvedValue([
        { year: 2026, month: 1, status: 'CLOSED' },
        { year: 2026, month: 2, status: 'SYNCED' },
      ]);

      const result = await service.getPeriodsOverview('company-1', 2026);

      expect(result).toHaveLength(12);
      expect(result[0].status).toBe('CLOSED');
      expect(result[1].status).toBe('SYNCED');
      expect(result[2].status).toBe('OPEN'); // March — no record
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && npx jest monthly-close.service.spec --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement MonthlyCloseService**

```typescript
// monthly-close.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { TaxService } from '../tax/tax.service';
import { PeakService } from '../../modules/peak/peak.service';
import { AccountingService } from './accounting.service';
import { AccountingPeriodStatus } from '@prisma/client';

@Injectable()
export class MonthlyCloseService {
  private readonly logger = new Logger(MonthlyCloseService.name);

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private taxService: TaxService,
    private peakService: PeakService,
    private accountingService: AccountingService,
  ) {}

  async getPeriodStatus(companyId: string, year: number, month: number) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
      include: {
        reviewStartedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
      },
    });

    if (!period) {
      return {
        status: 'OPEN' as AccountingPeriodStatus,
        year,
        month,
        companyId,
      };
    }

    return period;
  }

  async startReview(companyId: string, year: number, month: number, userId: string) {
    const existing = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (existing && existing.status !== 'OPEN') {
      throw new BadRequestException(
        `ไม่สามารถเริ่ม review ได้ — สถานะปัจจุบัน: ${existing.status}`,
      );
    }

    // Run data audit checks
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const [journalCount, unbalancedJournals, paymentsWithoutBreakdown] = await Promise.all([
      this.prisma.journalEntry.count({
        where: {
          companyId,
          entryDate: { gte: startDate, lte: endDate },
          status: 'POSTED',
          deletedAt: null,
        },
      }),
      this.prisma.journalEntry.findMany({
        where: {
          companyId,
          entryDate: { gte: startDate, lte: endDate },
          status: 'POSTED',
          deletedAt: null,
        },
        include: { lines: true },
      }).then(entries => entries.filter(e => {
        const totalDebit = e.lines.reduce((sum, l) => sum + Number(l.debit), 0);
        const totalCredit = e.lines.reduce((sum, l) => sum + Number(l.credit), 0);
        return Math.abs(totalDebit - totalCredit) > 0.01;
      })),
      this.prisma.payment.count({
        where: {
          paidDate: { gte: startDate, lte: endDate },
          status: 'PAID',
          monthlyPrincipal: null,
          contract: { deletedAt: null },
        },
      }),
    ]);

    const auditIssues = {
      journalCount,
      unbalancedJournals: unbalancedJournals.map(j => ({
        id: j.id,
        entryNumber: j.entryNumber,
      })),
      paymentsWithoutBreakdown,
      hasIssues: unbalancedJournals.length > 0 || paymentsWithoutBreakdown > 0,
    };

    const period = await this.prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId, year, month } },
      create: {
        companyId,
        year,
        month,
        status: 'REVIEW',
        reviewStartedAt: new Date(),
        reviewStartedById: userId,
        auditIssues,
      },
      update: {
        status: 'REVIEW',
        reviewStartedAt: new Date(),
        reviewStartedById: userId,
        auditIssues,
      },
    });

    return { ...period, auditIssues };
  }

  async closePeriod(companyId: string, year: number, month: number, userId: string, notes?: string) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!period || period.status !== 'REVIEW') {
      throw new BadRequestException(
        'ต้อง Review ก่อนปิดงวด — กดปุ่ม "เริ่ม Review" ก่อน',
      );
    }

    // Generate report snapshots
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const [trialBalance, pl, balanceSheet, vatSummary] = await Promise.all([
      this.journalAutoService.getTrialBalance({
        companyId,
        asOfDate: endDate,
      }),
      this.accountingService.getProfitAndLoss({
        companyId,
        startDate,
        endDate,
      }),
      this.accountingService.getBalanceSheet({
        companyId,
        asOfDate: endDate,
      }),
      this.taxService.previewPP30(companyId, year, month),
    ]);

    const reportSnapshot = { trialBalance, pl, balanceSheet, vatSummary };

    return this.prisma.accountingPeriod.update({
      where: { id: period.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: userId,
        reportSnapshot,
        notes,
      },
    });
  }

  async syncToPeak(companyId: string, year: number, month: number) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!period || (period.status !== 'CLOSED' && period.status !== 'SYNCED')) {
      throw new BadRequestException('ต้องปิดงวดก่อนจึงจะ sync ได้');
    }

    if (!this.peakService.isConfigured()) {
      throw new BadRequestException('PEAK ยังไม่ได้ตั้งค่า — ต้องการ PEAK_USER_TOKEN, PEAK_CONNECT_ID, PEAK_SECRET_KEY');
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    try {
      const result = await this.peakService.exportJournalEntries(startDate, endDate);

      await this.prisma.accountingPeriod.update({
        where: { id: period.id },
        data: {
          status: 'SYNCED',
          peakSyncedAt: new Date(),
          peakSyncResult: result,
        },
      });

      return result;
    } catch (error) {
      Sentry.captureException(error, {
        tags: { kind: 'peak-sync', year: String(year), month: String(month) },
      });
      throw error;
    }
  }

  async reopenPeriod(companyId: string, year: number, month: number) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!period) throw new BadRequestException('ไม่พบงวดบัญชี');
    if (period.status === 'SYNCED') {
      throw new BadRequestException('ไม่สามารถเปิดงวดที่ sync ไป PEAK แล้ว');
    }

    return this.prisma.accountingPeriod.update({
      where: { id: period.id },
      data: {
        status: 'OPEN',
        reviewStartedAt: null,
        reviewStartedById: null,
        closedAt: null,
        closedById: null,
        reportSnapshot: null,
        auditIssues: null,
      },
    });
  }

  async getPeriodsOverview(companyId: string, year: number) {
    const periods = await this.prisma.accountingPeriod.findMany({
      where: { companyId, year },
      orderBy: { month: 'asc' },
      include: {
        closedBy: { select: { id: true, name: true } },
      },
    });

    // Return 12 months, filling gaps with OPEN
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const found = periods.find((p) => p.month === month);
      return found || { year, month, status: 'OPEN' as AccountingPeriodStatus, companyId };
    });
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest monthly-close.service.spec --no-coverage
```

Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/accounting/
git commit -m "feat(accounting): MonthlyCloseService with workflow + 7 tests

OPEN → REVIEW (data audit) → CLOSED (report snapshot) → SYNCED (PEAK).
Reopen allowed for non-SYNCED periods."
```

---

## Task 4: Wire controller endpoints + module

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts`
- Modify: `apps/api/src/modules/accounting/accounting.module.ts`

- [ ] **Step 1: Register MonthlyCloseService in module**

```typescript
import { MonthlyCloseService } from './monthly-close.service';

// Add to providers:
providers: [..., MonthlyCloseService],
// Add to exports if needed by other modules:
exports: [..., MonthlyCloseService],
```

Ensure `JournalModule`, `TaxModule`, `PeakModule` are in imports.

- [ ] **Step 2: Add endpoints to controller**

```typescript
import { MonthlyCloseService } from './monthly-close.service';
import { CloseMonthDto } from './dto/monthly-close.dto';

// Inject in constructor:
// private monthlyCloseService: MonthlyCloseService,

// --- Monthly Close Workflow ---

@Get('periods/overview')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
async getPeriodsOverview(
  @Query('companyId') companyId: string,
  @Query('year') year: string,
) {
  return this.monthlyCloseService.getPeriodsOverview(companyId, parseInt(year));
}

@Get('periods/:companyId/:year/:month')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
async getPeriodStatus(
  @Param('companyId') companyId: string,
  @Param('year') year: string,
  @Param('month') month: string,
) {
  return this.monthlyCloseService.getPeriodStatus(companyId, parseInt(year), parseInt(month));
}

@Post('periods/start-review')
@Roles('OWNER', 'FINANCE_MANAGER')
async startReview(@Body() dto: CloseMonthDto, @Request() req: any) {
  return this.monthlyCloseService.startReview(dto.companyId, dto.year, dto.month, req.user.id);
}

@Post('periods/close')
@Roles('OWNER', 'FINANCE_MANAGER')
async closePeriod(@Body() dto: CloseMonthDto, @Request() req: any) {
  return this.monthlyCloseService.closePeriod(dto.companyId, dto.year, dto.month, req.user.id, dto.notes);
}

@Post('periods/sync-peak')
@Roles('OWNER', 'ACCOUNTANT')
async syncToPeak(@Body() dto: CloseMonthDto) {
  return this.monthlyCloseService.syncToPeak(dto.companyId, dto.year, dto.month);
}

@Post('periods/reopen')
@Roles('OWNER')
async reopenPeriod(@Body() dto: CloseMonthDto) {
  return this.monthlyCloseService.reopenPeriod(dto.companyId, dto.year, dto.month);
}
```

- [ ] **Step 3: Run type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/accounting/
git commit -m "feat(accounting): monthly close API endpoints

GET overview, GET period status, POST start-review, POST close,
POST sync-peak, POST reopen. OWNER/FM/ACCOUNTANT roles."
```

---

## Task 5: Monthly Close page (frontend)

**Files:**
- Create: `apps/web/src/pages/MonthlyClosePage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create MonthlyClosePage**

```typescript
// MonthlyClosePage.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  CheckCircle2, Circle, Clock, CloudUpload, Lock, Unlock, AlertTriangle, FileText,
} from 'lucide-react';

interface Period {
  year: number;
  month: number;
  status: 'OPEN' | 'REVIEW' | 'CLOSED' | 'SYNCED';
  companyId: string;
  closedAt?: string;
  closedBy?: { name: string };
  peakSyncedAt?: string;
  peakSyncResult?: { exported: number; skipped: number; errors: string[] };
  auditIssues?: { journalCount: number; unbalancedJournals: any[]; paymentsWithoutBreakdown: number; hasIssues: boolean };
  reportSnapshot?: any;
}

const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const statusConfig = {
  OPEN: { label: 'เปิด', color: 'text-gray-500', bg: 'bg-gray-100', icon: Circle },
  REVIEW: { label: 'กำลัง Review', color: 'text-yellow-600', bg: 'bg-yellow-100', icon: Clock },
  CLOSED: { label: 'ปิดแล้ว', color: 'text-green-600', bg: 'bg-green-100', icon: CheckCircle2 },
  SYNCED: { label: 'Sync PEAK แล้ว', color: 'text-blue-600', bg: 'bg-blue-100', icon: CloudUpload },
};

export default function MonthlyClosePage() {
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);

  // TODO: Get companyId from selector or auth context
  const companyId = 'finance-company-id'; // placeholder — wire to actual company selector

  const { data: periods = [] } = useQuery<Period[]>({
    queryKey: ['accounting-periods', companyId, year],
    queryFn: () => api.get(`/accounting/periods/overview?companyId=${companyId}&year=${year}`).then(r => r.data),
  });

  const startReviewMutation = useMutation({
    mutationFn: (p: Period) => api.post('/accounting/periods/start-review', { companyId: p.companyId, year: p.year, month: p.month }),
    onSuccess: (_, p) => {
      queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });
      toast.success(`เริ่ม Review ${monthNames[p.month - 1]} ${p.year}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const closeMutation = useMutation({
    mutationFn: (p: Period) => api.post('/accounting/periods/close', { companyId: p.companyId, year: p.year, month: p.month }),
    onSuccess: (_, p) => {
      queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });
      toast.success(`ปิดงวด ${monthNames[p.month - 1]} ${p.year} สำเร็จ`);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const syncMutation = useMutation({
    mutationFn: (p: Period) => api.post('/accounting/periods/sync-peak', { companyId: p.companyId, year: p.year, month: p.month }),
    onSuccess: (res, p) => {
      queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });
      toast.success(`Sync PEAK สำเร็จ: ${res.data.exported} รายการ`);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Sync ไม่สำเร็จ'),
  });

  const reopenMutation = useMutation({
    mutationFn: (p: Period) => api.post('/accounting/periods/reopen', { companyId: p.companyId, year: p.year, month: p.month }),
    onSuccess: (_, p) => {
      queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });
      toast.success(`เปิดงวด ${monthNames[p.month - 1]} ${p.year} ใหม่`);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ปิดบัญชีรายเดือน</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="px-3 py-1 rounded border hover:bg-gray-50">&lt;</button>
          <span className="font-medium w-16 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="px-3 py-1 rounded border hover:bg-gray-50">&gt;</button>
        </div>
      </div>

      {/* Year grid */}
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {periods.map((p) => {
          const config = statusConfig[p.status];
          const StatusIcon = config.icon;
          return (
            <button
              key={p.month}
              onClick={() => setSelectedPeriod(p)}
              className={`rounded-lg border p-4 text-left hover:shadow-md transition-shadow ${
                selectedPeriod?.month === p.month ? 'ring-2 ring-primary' : ''
              }`}
            >
              <div className="text-sm font-medium">{monthNames[p.month - 1]} {p.year}</div>
              <div className={`flex items-center gap-1.5 mt-2 text-xs font-medium ${config.color}`}>
                <StatusIcon className="h-3.5 w-3.5" />
                {config.label}
              </div>
              {p.closedAt && (
                <div className="text-xs text-gray-400 mt-1">
                  ปิดโดย {p.closedBy?.name}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Period detail panel */}
      {selectedPeriod && (
        <div className="rounded-lg border bg-white p-6 space-y-4">
          <h2 className="text-lg font-bold">
            {monthNames[selectedPeriod.month - 1]} {selectedPeriod.year}
            <span className={`ml-3 text-sm font-normal ${statusConfig[selectedPeriod.status].color}`}>
              {statusConfig[selectedPeriod.status].label}
            </span>
          </h2>

          {/* Audit issues */}
          {selectedPeriod.auditIssues?.hasIssues && (
            <div className="flex items-start gap-3 rounded-lg bg-yellow-50 border border-yellow-200 p-4">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-yellow-800">พบปัญหาที่ต้องตรวจสอบ</div>
                {selectedPeriod.auditIssues.unbalancedJournals.length > 0 && (
                  <div className="text-yellow-700 mt-1">
                    Journal ไม่ balance: {selectedPeriod.auditIssues.unbalancedJournals.length} รายการ
                  </div>
                )}
                {selectedPeriod.auditIssues.paymentsWithoutBreakdown > 0 && (
                  <div className="text-yellow-700 mt-1">
                    Payment ไม่มี breakdown: {selectedPeriod.auditIssues.paymentsWithoutBreakdown} รายการ
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PEAK sync result */}
          {selectedPeriod.peakSyncResult && (
            <div className="text-sm text-gray-600">
              <FileText className="inline h-4 w-4 mr-1" />
              PEAK Sync: {selectedPeriod.peakSyncResult.exported} exported,{' '}
              {selectedPeriod.peakSyncResult.skipped} skipped
              {selectedPeriod.peakSyncResult.errors.length > 0 && (
                <span className="text-red-600"> ({selectedPeriod.peakSyncResult.errors.length} errors)</span>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            {selectedPeriod.status === 'OPEN' && (
              <button
                onClick={() => startReviewMutation.mutate(selectedPeriod)}
                disabled={startReviewMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-600 disabled:opacity-50"
              >
                <Clock className="h-4 w-4" />
                เริ่ม Review
              </button>
            )}
            {selectedPeriod.status === 'REVIEW' && (
              <button
                onClick={() => closeMutation.mutate(selectedPeriod)}
                disabled={closeMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                <Lock className="h-4 w-4" />
                ปิดงวด
              </button>
            )}
            {selectedPeriod.status === 'CLOSED' && (
              <button
                onClick={() => syncMutation.mutate(selectedPeriod)}
                disabled={syncMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <CloudUpload className="h-4 w-4" />
                Sync ไป PEAK
              </button>
            )}
            {(selectedPeriod.status === 'REVIEW' || selectedPeriod.status === 'CLOSED') && (
              <button
                onClick={() => {
                  if (window.confirm('เปิดงวดใหม่? ข้อมูล report snapshot จะถูกลบ')) {
                    reopenMutation.mutate(selectedPeriod);
                  }
                }}
                disabled={reopenMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                <Unlock className="h-4 w-4" />
                เปิดงวดใหม่
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

```typescript
const MonthlyClosePage = lazy(() => import('@/pages/MonthlyClosePage'));

<Route path="/monthly-close" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}><MonthlyClosePage /></ProtectedRoute>} />
```

- [ ] **Step 3: Add sidebar link in Finance section**

Label: "ปิดบัญชีรายเดือน", path: `/monthly-close`

- [ ] **Step 4: Run type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/MonthlyClosePage.tsx apps/web/src/App.tsx
git commit -m "feat(accounting): Monthly Close page

Year grid (12 months), period detail panel, workflow buttons
(Review → Close → Sync PEAK → Reopen), audit issue warnings."
```

---

## Task 6: PEAK Sync status page (frontend)

**Files:**
- Create: `apps/web/src/pages/PeakSyncPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create PeakSyncPage**

```typescript
// PeakSyncPage.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CheckCircle2, XCircle, Clock, CloudUpload, Settings } from 'lucide-react';

interface PeakStatus {
  configured: boolean;
  baseUrl: string;
  message: string;
}

export default function PeakSyncPage() {
  const { data: status } = useQuery<PeakStatus>({
    queryKey: ['peak-status'],
    queryFn: () => api.get('/peak/status').then(r => r.data),
  });

  const currentYear = new Date().getFullYear();
  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['peak-periods', currentYear],
    queryFn: () => api.get(`/accounting/periods/overview?companyId=finance-company-id&year=${currentYear}`).then(r => r.data),
  });

  const syncedPeriods = periods.filter(p => p.status === 'SYNCED');
  const closedPeriods = periods.filter(p => p.status === 'CLOSED');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">PEAK Accounting Sync</h1>

      {/* Connection status */}
      <div className={`rounded-lg border p-6 ${status?.configured ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center gap-3">
          {status?.configured
            ? <CheckCircle2 className="h-6 w-6 text-green-600" />
            : <XCircle className="h-6 w-6 text-red-600" />}
          <div>
            <div className="font-medium">{status?.message}</div>
            <div className="text-sm text-gray-500 mt-1">Base URL: {status?.baseUrl}</div>
          </div>
        </div>
      </div>

      {/* Sync summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <CloudUpload className="h-4 w-4" /> Synced
          </div>
          <div className="text-2xl font-bold text-blue-600">{syncedPeriods.length}</div>
          <div className="text-sm text-gray-500">เดือนที่ sync แล้ว</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Clock className="h-4 w-4" /> รอ Sync
          </div>
          <div className="text-2xl font-bold text-yellow-600">{closedPeriods.length}</div>
          <div className="text-sm text-gray-500">เดือนที่ปิดแล้วแต่ยังไม่ sync</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Settings className="h-4 w-4" /> สถานะ
          </div>
          <div className={`text-2xl font-bold ${status?.configured ? 'text-green-600' : 'text-red-600'}`}>
            {status?.configured ? 'เชื่อมต่อแล้ว' : 'ยังไม่ตั้งค่า'}
          </div>
        </div>
      </div>

      {/* Period sync status table */}
      <div className="rounded-lg border bg-white">
        <div className="p-4 border-b">
          <h2 className="font-semibold">สถานะรายเดือน {currentYear}</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-3">เดือน</th>
              <th className="text-left p-3">สถานะงวด</th>
              <th className="text-left p-3">PEAK Sync</th>
              <th className="text-left p-3">Exported</th>
              <th className="text-left p-3">Errors</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p: any) => (
              <tr key={p.month} className="border-b">
                <td className="p-3 font-medium">{p.month}/{p.year}</td>
                <td className="p-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.status === 'SYNCED' ? 'bg-blue-100 text-blue-700'
                    : p.status === 'CLOSED' ? 'bg-green-100 text-green-700'
                    : p.status === 'REVIEW' ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600'
                  }`}>
                    {p.status}
                  </span>
                </td>
                <td className="p-3">
                  {p.peakSyncedAt
                    ? new Date(p.peakSyncedAt).toLocaleDateString('th-TH')
                    : <span className="text-gray-400">-</span>}
                </td>
                <td className="p-3">{p.peakSyncResult?.exported ?? '-'}</td>
                <td className="p-3">
                  {p.peakSyncResult?.errors?.length > 0
                    ? <span className="text-red-600">{p.peakSyncResult.errors.length}</span>
                    : <span className="text-gray-400">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

```typescript
const PeakSyncPage = lazy(() => import('@/pages/PeakSyncPage'));

<Route path="/settings/peak-sync" element={<ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}><PeakSyncPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Run type check + test in browser**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/PeakSyncPage.tsx apps/web/src/App.tsx
git commit -m "feat(accounting): PEAK Sync status page

Connection status, sync summary (synced/pending/errors),
monthly status table with export counts."
```

---

## Task 7: Migrate validatePeriodOpen to use AccountingPeriod model

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts`

- [ ] **Step 1: Read current validatePeriodOpen implementation**

Find `validatePeriodOpen` in accounting.service.ts — it currently reads from `SystemConfig`.

- [ ] **Step 2: Update to check AccountingPeriod model**

Replace the SystemConfig-based check with:

```typescript
async validatePeriodOpen(date: Date, companyId?: string) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  // Check AccountingPeriod model first
  if (companyId) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (period && (period.status === 'CLOSED' || period.status === 'SYNCED')) {
      throw new BadRequestException(
        `งวดบัญชี ${month}/${year} ปิดแล้ว ไม่สามารถบันทึกรายการได้`,
      );
    }
  }

  // Fallback: also check legacy SystemConfig for backward compatibility
  const closedUntil = await this.prisma.systemConfig.findUnique({
    where: { key: 'accounting_period_closed_until' },
  });
  if (closedUntil?.value) {
    const closedDate = new Date(closedUntil.value);
    if (date <= closedDate) {
      throw new BadRequestException(
        `งวดบัญชีถึง ${closedDate.toLocaleDateString('th-TH')} ปิดแล้ว`,
      );
    }
  }
}
```

- [ ] **Step 3: Run existing accounting tests**

```bash
cd apps/api && npx jest accounting.service.spec --no-coverage
```

Expected: All existing tests pass (mock should handle new prisma call).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/accounting/accounting.service.ts
git commit -m "feat(accounting): validatePeriodOpen checks AccountingPeriod model

Falls back to SystemConfig for backward compatibility.
Rejects entries in CLOSED or SYNCED periods."
```

---

## Task 8: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 2: Run all API tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: All existing + new tests pass.

- [ ] **Step 3: Manual smoke test**

1. Login as admin
2. `/monthly-close` — see 12 months grid
3. Click a month → "เริ่ม Review" → verify audit issues shown
4. "ปิดงวด" → verify status changes to CLOSED
5. `/settings/peak-sync` — see connection status (unconfigured is OK)
6. Verify existing accounting pages still work (P&L, Balance Sheet, Tax Reports)

- [ ] **Step 4: Commit if fixes needed**

```bash
git add -A && git commit -m "fix: address issues from accounting structure verification"
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | AccountingPeriod model + migration | Schema validation |
| 2 | Backfill payment breakdown migration | Query verification |
| 3 | MonthlyCloseService (workflow engine) | 7 unit tests |
| 4 | Controller endpoints + module wiring | Type check |
| 5 | MonthlyClosePage (frontend) | Manual + type check |
| 6 | PeakSyncPage (frontend) | Manual + type check |
| 7 | Migrate validatePeriodOpen | Existing tests |
| 8 | Full verification | All tests + smoke test |

**Key insight:** The accounting system is already very mature. This plan adds the **missing orchestration layer** (formal monthly close workflow) rather than rebuilding accounting logic. Journal generation, tax reports, PEAK export, and period locking already work — we're just formalizing the process and adding a UI for it.

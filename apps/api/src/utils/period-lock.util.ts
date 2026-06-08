/**
 * Accounting period lock utility
 *
 * Single source of truth = `AccountingPeriod` (per-company, per-month status).
 * Prevents posting/voiding accounting transactions into a CLOSED or SYNCED
 * period — UNLESS today is still inside the `period_grace_days` window.
 *
 * (2026-06 unify) The legacy global SystemConfig cutoff
 * `accounting_period_closed_until` was removed; AccountingPeriod is now the only
 * mechanism. Every accounting write path resolves the FINANCE/SHOP companyId and
 * passes it here. A call without companyId is intentionally a no-op.
 *
 * Used by: JournalService, PaymentsService, ReceiptsService, ContractPaymentService,
 *          AssetService, DepreciationService, OtherIncomeService,
 *          ExpenseDocumentsService, IntercompanyService, RefundsService,
 *          installment-accrual.cron
 */
import { BadRequestException } from '@nestjs/common';

interface PrismaLike {
  systemConfig: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
  };
  accountingPeriod?: {
    findUnique(args: {
      where: { companyId_year_month: { companyId: string; year: number; month: number } };
      select: { status: true };
    }): Promise<{ status: string } | null>;
  };
}

/**
 * D1.2.6.2 — read the OWNER-editable `period_grace_days` SystemConfig key.
 * Default 5 (matches the project deadline reference "grace through
 * 5 มิ.ย. 2569 per period_grace_days"). Invalid/missing → default.
 */
async function getGraceDays(prisma: PrismaLike): Promise<number> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: 'period_grace_days' },
    });
    if (!row?.value) return 5;
    const n = Number.parseInt(row.value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  } catch {
    return 5;
  }
}

/** Last day of the given calendar month (month 1-12). */
function lastDayOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0);
}

/** Returns `base + days` as a Date. */
function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Validate that a transaction date is not in a closed accounting period.
 *
 * Looks up the AccountingPeriod for the date's (companyId, year, month). Throws
 * if its status is CLOSED or SYNCED — UNLESS today is within `period_grace_days`
 * after the period's last calendar day (D1.2.6.2).
 *
 * Enforcement REQUIRES companyId: callers that do not pass one are not guarded.
 */
export async function validatePeriodOpen(
  prisma: PrismaLike,
  date: Date,
  companyId?: string,
): Promise<void> {
  if (!companyId || !prisma.accountingPeriod) return;

  const year = date.getFullYear();
  const month = date.getMonth() + 1; // JS months are 0-indexed
  const period = await prisma.accountingPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
    select: { status: true },
  });
  if (!period || (period.status !== 'CLOSED' && period.status !== 'SYNCED')) {
    return; // OPEN / REVIEW / no row → not locked
  }

  // D1.2.6.2 — grace window. Allow posting INTO a closed period for
  // `graceDays` after the period's last calendar day.
  const graceDays = await getGraceDays(prisma);
  const graceEnd = addDays(lastDayOfMonth(year, month), graceDays);
  if (new Date() > graceEnd) {
    throw new BadRequestException(
      `ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (${year}/${String(month).padStart(2, '0')} สถานะ: ${period.status})`,
    );
  }
}

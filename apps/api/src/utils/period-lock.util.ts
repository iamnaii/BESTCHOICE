/**
 * Accounting period lock utility
 *
 * Single source of truth = `AccountingPeriod` (per-company, per-month status).
 * Prevents posting/voiding accounting transactions into a CLOSED or SYNCED
 * period — UNLESS today is still inside the `period_grace_days` window.
 *
 * Grace window (owner decision 2026-10-31): counted in whole Asia/Bangkok days
 * AFTER the period's last day — grace 0 keeps the last day itself postable until
 * 23:59:59.999 BKK (closing the current month early never blocks its own last
 * day); grace N stays open through the N-th day of the following month. The
 * period month is also read on the Bangkok calendar, so the verdict does not
 * depend on the process TZ.
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
import { bangkokCalendarParts, bangkokMidnight } from './date.util';

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
async function getGraceDays(prisma: Pick<PrismaLike, 'systemConfig'>): Promise<number> {
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

/**
 * (year, month 1-12) of the accounting period `date` falls in — the Bangkok calendar, independent of the
 * process TZ. The single month rule shared by `validatePeriodOpen` and every caller that locks the
 * `accounting_periods` row FOR SHARE before checking it (activation · exchange cancel · payoff/settlement
 * postings) — the locked row must be the row the guard reads (review M2, 2026-10-31).
 */
export function accountingPeriodOf(date: Date): { year: number; month: number } {
  const parts = bangkokCalendarParts(date);
  return { year: parts.year, month: parts.month + 1 }; // bangkokCalendarParts month is 0-indexed
}

/**
 * First instant at which a CLOSED/SYNCED period (`month` 1-12) stops accepting
 * postings: 00:00 Asia/Bangkok on day `1 + graceDays` of the following month.
 * grace 0 → 00:00 BKK on the 1st (the whole last day is still inside);
 * grace N → 00:00 BKK on day N+1 (N whole days after month end).
 */
export function periodGraceEnd(year: number, month: number, graceDays: number): Date {
  // `month` is 1-12, i.e. already the 0-based index of the FOLLOWING month (12 → next January)
  return bangkokMidnight(year, month, 1 + graceDays);
}

/** Statuses that close a period (after the grace window). OPEN / REVIEW never lock. */
const LOCKING_STATUSES = ['CLOSED', 'SYNCED'] as const;
const isLockingStatus = (status: string) =>
  (LOCKING_STATUSES as readonly string[]).includes(status);

/** The single "is this period locked right now" rule — `validatePeriodOpen` and `lockedAccountingPeriods` both call it. */
function isPeriodLockedNow(
  status: string,
  year: number,
  month: number,
  graceDays: number,
): boolean {
  return isLockingStatus(status) && new Date() >= periodGraceEnd(year, month, graceDays);
}

interface LockedPeriodsReader {
  systemConfig: PrismaLike['systemConfig'];
  accountingPeriod: {
    findMany(args: {
      where: { companyId: string; status: { in: (typeof LOCKING_STATUSES)[number][] } };
      select: { year: true; month: true; status: true };
    }): Promise<{ year: number; month: number; status: string }[]>;
  };
}

/**
 * Every period of `companyId` that `validatePeriodOpen` would reject right now (CLOSED/SYNCED and past
 * its grace window) — same rule, evaluated per period instead of per date. Lets a batch exclude those
 * months up front instead of fetching rows only to have the guard skip them one by one (the 2A accrual
 * cron — review M5, 2026-10-31).
 */
export async function lockedAccountingPeriods(
  prisma: LockedPeriodsReader,
  companyId: string,
): Promise<{ year: number; month: number }[]> {
  const closed = await prisma.accountingPeriod.findMany({
    where: { companyId, status: { in: [...LOCKING_STATUSES] } },
    select: { year: true, month: true, status: true },
  });
  if (closed.length === 0) return [];
  const graceDays = await getGraceDays(prisma);
  return closed
    .filter((p) => isPeriodLockedNow(p.status, p.year, p.month, graceDays))
    .map(({ year, month }) => ({ year, month }));
}

/**
 * Validate that a transaction date is not in a closed accounting period.
 *
 * Looks up the AccountingPeriod for the date's (companyId, year, month) on the
 * Bangkok calendar. Throws if its status is CLOSED or SYNCED — UNLESS now is
 * before `periodGraceEnd` (the period's last day + `period_grace_days` whole
 * Bangkok days — D1.2.6.2, boundary per owner decision 2026-10-31).
 *
 * Enforcement REQUIRES companyId: callers that do not pass one are not guarded.
 */
export async function validatePeriodOpen(
  prisma: PrismaLike,
  date: Date,
  companyId?: string,
): Promise<void> {
  if (!companyId || !prisma.accountingPeriod) return;

  const { year, month } = accountingPeriodOf(date);
  const period = await prisma.accountingPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
    select: { status: true },
  });
  if (!period || !isLockingStatus(period.status)) {
    return; // OPEN / REVIEW / no row → not locked
  }

  // D1.2.6.2 — grace window. Allow posting INTO a closed period through the end
  // of its last day plus `graceDays` whole days (Bangkok).
  const graceDays = await getGraceDays(prisma);
  if (isPeriodLockedNow(period.status, year, month, graceDays)) {
    throw new BadRequestException(
      `ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (${year}/${String(month).padStart(2, '0')} สถานะ: ${period.status})`,
    );
  }
}

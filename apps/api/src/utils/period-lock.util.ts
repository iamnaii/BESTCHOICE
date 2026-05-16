/**
 * Accounting period lock utility
 * Shared validation to prevent transactions in closed accounting periods.
 * Used by: AccountingService, PaymentsService, ReceiptsService
 */
import { BadRequestException } from '@nestjs/common';

interface PrismaLike {
  systemConfig: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    findFirst?(args: {
      where: { key: string; deletedAt?: null };
      select?: { value: true };
    }): Promise<{ value: string } | null>;
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
 * Two-tier check:
 * 1. If companyId is provided: look up AccountingPeriod for the date's year+month.
 *    Throws if status is CLOSED or SYNCED — UNLESS today is within
 *    `period_grace_days` after the period's last calendar day (D1.2.6.2).
 * 2. Fallback: check legacy SystemConfig key `accounting_period_closed_until`.
 *    Throws if `date <= closedUntil` — UNLESS today is within
 *    `period_grace_days` after `closedUntil`.
 *
 * Both checks are run when companyId is provided (belt-and-suspenders).
 */
export async function validatePeriodOpen(
  prisma: PrismaLike,
  date: Date,
  companyId?: string,
): Promise<void> {
  const graceDays = await getGraceDays(prisma);
  const today = new Date();

  // ── Tier 1: AccountingPeriod model check (when companyId is available) ────
  if (companyId && prisma.accountingPeriod) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // JS months are 0-indexed
    const period = await prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
      select: { status: true },
    });
    if (period && (period.status === 'CLOSED' || period.status === 'SYNCED')) {
      // D1.2.6.2 — grace window. Allow posting INTO a closed period for
      // `graceDays` after the period's last calendar day.
      const periodLastDay = lastDayOfMonth(year, month);
      const graceEnd = addDays(periodLastDay, graceDays);
      if (today > graceEnd) {
        throw new BadRequestException(
          `ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (${year}/${String(month).padStart(2, '0')} สถานะ: ${period.status})`,
        );
      }
      // else: within grace window → fall through (allowed)
    }
  }

  // ── Tier 2: Legacy SystemConfig check (backward compatibility) ────────────
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'accounting_period_closed_until' },
  });
  if (config) {
    const closedUntil = new Date(config.value);
    if (date <= closedUntil) {
      // D1.2.6.2 — same grace window applied to the legacy cutoff.
      const graceEnd = addDays(closedUntil, graceDays);
      if (today > graceEnd) {
        throw new BadRequestException(
          `ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (ปิดถึง ${closedUntil.toISOString().split('T')[0]})`,
        );
      }
    }
  }
}

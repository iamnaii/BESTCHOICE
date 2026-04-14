/**
 * Accounting period lock utility
 * Shared validation to prevent transactions in closed accounting periods.
 * Used by: AccountingService, PaymentsService, ReceiptsService
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
 * Validate that a transaction date is not in a closed accounting period.
 *
 * Two-tier check:
 * 1. If companyId is provided: look up AccountingPeriod for the date's year+month.
 *    Throws if status is CLOSED or SYNCED (period locked).
 * 2. Fallback: check legacy SystemConfig key `accounting_period_closed_until`.
 *    Throws if the date falls on or before the closed-until date.
 *
 * Both checks are run when companyId is provided (belt-and-suspenders).
 */
export async function validatePeriodOpen(
  prisma: PrismaLike,
  date: Date,
  companyId?: string,
): Promise<void> {
  // ── Tier 1: AccountingPeriod model check (when companyId is available) ────
  if (companyId && prisma.accountingPeriod) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // JS months are 0-indexed
    const period = await prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
      select: { status: true },
    });
    if (period && (period.status === 'CLOSED' || period.status === 'SYNCED')) {
      throw new BadRequestException(
        `ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (${year}/${String(month).padStart(2, '0')} สถานะ: ${period.status})`,
      );
    }
  }

  // ── Tier 2: Legacy SystemConfig check (backward compatibility) ────────────
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'accounting_period_closed_until' },
  });
  if (config) {
    const closedUntil = new Date(config.value);
    if (date <= closedUntil) {
      throw new BadRequestException(
        `ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (ปิดถึง ${closedUntil.toISOString().split('T')[0]})`,
      );
    }
  }
}

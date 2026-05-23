import { NotFoundException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Resolve the interest rate for a given (config, months) pair.
 *
 * Feature flag `USE_NEW_RATE_LOOKUP`:
 *  - When 'true': reads from InterestConfigRate table (new per-month-count rate)
 *  - When unset/false: falls back to legacy `InterestConfig.interestRate × months` (per-month flat × months)
 *
 * Both paths return a TOTAL-CONTRACT rate (the value used as `financed × ratePct = interestAmount`).
 *
 * Removed in PR 9 once feature flag stable in prod for 2+ weeks.
 */
export async function getRateForMonths(
  prisma: PrismaClient,
  configId: string,
  months: number,
): Promise<Prisma.Decimal> {
  const useNewLookup = process.env.USE_NEW_RATE_LOOKUP === 'true';

  if (useNewLookup) {
    const row = await prisma.interestConfigRate.findUnique({
      where: { configId_months: { configId, months } },
    });
    if (!row || row.deletedAt) {
      throw new NotFoundException(
        `ไม่พบอัตราดอกเบี้ยสำหรับ ${months} งวด (configId=${configId})`,
      );
    }
    return new Prisma.Decimal(row.ratePct);
  }

  // Legacy path: rate × months
  const config = await prisma.interestConfig.findUnique({ where: { id: configId } });
  if (!config || config.deletedAt) {
    throw new NotFoundException(`ไม่พบ InterestConfig (configId=${configId})`);
  }
  return new Prisma.Decimal(config.interestRate).mul(months);
}

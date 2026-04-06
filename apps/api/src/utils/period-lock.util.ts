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
}

/**
 * Validate that a transaction date is not in a closed accounting period.
 * Throws BadRequestException if the date falls on or before the closed-until date.
 */
export async function validatePeriodOpen(prisma: PrismaLike, date: Date): Promise<void> {
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

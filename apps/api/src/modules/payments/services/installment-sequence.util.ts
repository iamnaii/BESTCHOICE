import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * ต้องบันทึกชำระค่างวดตามลำดับงวดเท่านั้น — ห้ามข้ามงวด (owner directive 2026-08-19).
 *
 * The rule is "record only on the contract's EARLIEST unpaid installment", NOT
 * "installmentNo == lastPaid + 1". The distinction matters after a receipt VOID:
 * voiding งวด 2 while 3-6 are PAID re-opens งวด 2 as the earliest unpaid, and
 * re-paying it must be allowed (the void flow re-opens the wizard on exactly
 * that installment).
 *
 * Enforced at:
 *   - `PaymentReceiptOrchestrator.recordPayment` (inside the serializable tx —
 *     race-safe against two cashiers recording out of order concurrently)
 *   - QR-send time (`POST /payments/:id/partial-qr`) — the PaySolutions webhook
 *     BYPASSES the guard (`enforceSequence=false`) because by then the money has
 *     already been captured at the gateway and refusing to record it would strand
 *     real money; the sequence rule is applied where refusal is still safe.
 *
 * Unpaid = PENDING / OVERDUE / PARTIALLY_PAID — the same explicit allow-list the
 * pending queue uses (a PARTIALLY_PAID earlier installment must be closed before
 * a later one can be recorded).
 */
export async function assertSequentialInstallment(
  client: Prisma.TransactionClient | PrismaClient,
  contractId: string,
  installmentNo: number,
): Promise<void> {
  // งวดแรกไม่มีงวดก่อนหน้าโดยนิยาม — skip the query entirely.
  if (installmentNo <= 1) return;
  const earlierUnpaid = await client.payment.findFirst({
    where: {
      contractId,
      installmentNo: { lt: installmentNo },
      status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
      deletedAt: null,
    },
    orderBy: { installmentNo: 'asc' },
    select: { installmentNo: true },
  });
  if (earlierUnpaid) {
    throw new BadRequestException(
      `ต้องบันทึกชำระตามลำดับงวด — งวดที่ ${earlierUnpaid.installmentNo} ยังค้างอยู่ กรุณาชำระงวดที่ค้างก่อน (ข้ามงวดไม่ได้)`,
    );
  }
}

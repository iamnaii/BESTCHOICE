import { Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * VoucherNumberService — เลขที่ใบสำคัญจ่ายเงิน (Expense Voucher) สำหรับรายการรับซื้อมือถือ (Trade-In)
 *
 * - เลขที่ใบสำคัญรูปแบบ: EXP-YYYYMMNNNNN  (เช่น EXP-20260300064)
 * - Reset เลขลำดับทุกเดือน เริ่ม 00001
 * - allocate() ครอบ $transaction + P2002 retry + idempotency short-circuit
 */
export class VoucherNumberService {
  private readonly logger = new Logger(VoucherNumberService.name);

  constructor(private prisma: PrismaService) {}

  // ─── เลขที่ใบสำคัญ ────────────────────────────────────────
  private async generateVoucherNumber(tx: Prisma.TransactionClient): Promise<string> {
    const now = new Date();
    const prefix = `EXP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await tx.tradeIn.findFirst({
      where: { voucherNumber: { startsWith: prefix } },
      orderBy: { voucherNumber: 'desc' },
      select: { voucherNumber: true },
    });
    const seq = last?.voucherNumber
      ? parseInt(last.voucherNumber.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(seq).padStart(5, '0')}`;
  }

  // ─── Allocate voucher number (no PDF — render on-demand) ──
  async allocate(tradeInId: string): Promise<{
    voucherNumber: string;
    voucherDate: Date;
  }> {
    const tradeIn = await this.prisma.tradeIn.findUnique({
      where: { id: tradeInId },
      select: { id: true, status: true, deletedAt: true, voucherNumber: true, voucherDate: true, agreedPrice: true, offeredPrice: true },
    });
    if (!tradeIn || tradeIn.deletedAt) throw new NotFoundException('ไม่พบรายการรับซื้อ');
    if (tradeIn.status !== 'ACCEPTED' && tradeIn.status !== 'COMPLETED') {
      throw new BadRequestException('ใบสำคัญจ่ายเงินเงินสร้างได้เฉพาะรายการที่ ACCEPTED หรือ COMPLETED');
    }
    const amount = Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0);
    if (amount <= 0) throw new BadRequestException('ต้องระบุราคาที่ตกลงก่อนออกใบสำคัญ');

    // Idempotent: ถ้ามีเลขเดิมแล้วคืนเลย
    if (tradeIn.voucherNumber && tradeIn.voucherDate) {
      return { voucherNumber: tradeIn.voucherNumber, voucherDate: tradeIn.voucherDate };
    }

    // Race-safe: retry P2002 (unique collision) สูงสุด 5 ครั้ง
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const voucherNumber = await this.generateVoucherNumber(tx);
          const voucherDate = new Date();
          return tx.tradeIn.update({
            where: { id: tradeInId },
            data: { voucherNumber, voucherDate },
            select: { voucherNumber: true, voucherDate: true },
          });
        });
        return { voucherNumber: result.voucherNumber!, voucherDate: result.voucherDate! };
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code !== 'P2002') throw err;
        this.logger.warn(`Voucher number collision (attempt ${attempt + 1}), retrying`);
      }
    }
    throw new Error('Failed to allocate voucher number after retries');
  }
}

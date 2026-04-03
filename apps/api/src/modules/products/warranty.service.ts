import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WarrantyService {
  private readonly logger = new Logger(WarrantyService.name);

  constructor(private prisma: PrismaService) {}

  /** Get products with expiring warranty (within N days) */
  async getExpiringWarranties(daysAhead = 30, branchId?: string) {
    const now = new Date();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysAhead);

    const where: Record<string, unknown> = {
      warrantyExpired: false,
      warrantyExpireDate: { not: null, gte: now, lte: deadline },
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true, name: true, brand: true, model: true,
        imeiSerial: true, warrantyExpireDate: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: { warrantyExpireDate: 'asc' },
      take: 100,
    });

    return { count: products.length, daysAhead, products };
  }

  /** Mark expired warranties (cron job) */
  async markExpiredWarranties(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.product.updateMany({
      where: {
        warrantyExpired: false,
        warrantyExpireDate: { not: null, lt: now },
        deletedAt: null,
      },
      data: { warrantyExpired: true },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} products as warranty expired`);
    }
    return result.count;
  }

  /** Update warranty info for a product */
  async updateWarranty(productId: string, data: {
    warrantyExpireDate?: Date | null;
  }) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true },
    });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');

    const warrantyExpired = data.warrantyExpireDate
      ? data.warrantyExpireDate < new Date()
      : null;

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        warrantyExpireDate: data.warrantyExpireDate ?? null,
        warrantyExpired,
      },
    });
  }

  /** Get warranty summary stats */
  async getWarrantySummary(branchId?: string) {
    const where: Record<string, unknown> = { deletedAt: null, status: 'IN_STOCK' };
    if (branchId) where.branchId = branchId;

    const [total, withWarranty, expiringSoon, expired] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.count({
        where: { ...where, warrantyExpireDate: { not: null } },
      }),
      this.prisma.product.count({
        where: {
          ...where,
          warrantyExpired: false,
          warrantyExpireDate: {
            not: null,
            gte: new Date(),
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      this.prisma.product.count({
        where: { ...where, warrantyExpired: true },
      }),
    ]);

    return { total, withWarranty, expiringSoon, expired };
  }
}

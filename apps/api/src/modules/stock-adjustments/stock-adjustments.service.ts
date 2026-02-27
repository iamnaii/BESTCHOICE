import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';

@Injectable()
export class StockAdjustmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateStockAdjustmentDto, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException('ไม่พบสินค้า');
    }

    // FOUND: product is coming back → must be soft-deleted or already adjusted out
    if (dto.reason === 'FOUND') {
      if (product.status === 'IN_STOCK') {
        throw new BadRequestException('สินค้านี้อยู่ในสต๊อคอยู่แล้ว ไม่สามารถใช้เหตุผล "พบคืน" ได้');
      }
    } else {
      // DAMAGED, LOST, WRITE_OFF, CORRECTION, OTHER: product must be in stock
      const adjustableStatuses = ['IN_STOCK', 'PO_RECEIVED', 'INSPECTION'];
      if (!adjustableStatuses.includes(product.status)) {
        throw new BadRequestException(
          `ไม่สามารถปรับสต๊อคสินค้าสถานะ "${product.status}" ได้ (ต้องเป็น IN_STOCK, PO_RECEIVED, หรือ INSPECTION)`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Create adjustment record
      const adjustment = await tx.stockAdjustment.create({
        data: {
          productId: dto.productId,
          branchId: product.branchId,
          reason: dto.reason as any,
          previousStatus: product.status,
          notes: dto.notes,
          photos: dto.photos || [],
          adjustedById: userId,
        },
        include: {
          product: { select: { id: true, name: true, imeiSerial: true, brand: true, model: true } },
          branch: { select: { id: true, name: true } },
          adjustedBy: { select: { id: true, name: true } },
        },
      });

      // Update product status based on reason
      if (dto.reason === 'FOUND') {
        await tx.product.update({
          where: { id: dto.productId },
          data: { status: 'IN_STOCK', deletedAt: null },
        });
      } else {
        // DAMAGED, LOST, WRITE_OFF → soft delete (remove from active stock)
        await tx.product.update({
          where: { id: dto.productId },
          data: { deletedAt: new Date() },
        });
      }

      return adjustment;
    });
  }

  async findAll(filters: {
    branchId?: string;
    reason?: string;
    productId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.reason) where.reason = filters.reason;
    if (filters.productId) where.productId = filters.productId;

    const page = filters.page || 1;
    const limit = filters.limit || 50;

    const [data, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, imeiSerial: true, brand: true, model: true, costPrice: true } },
          branch: { select: { id: true, name: true } },
          adjustedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const adjustment = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true, name: true, imeiSerial: true, serialNumber: true,
            brand: true, model: true, color: true, storage: true,
            costPrice: true, category: true, photos: true,
          },
        },
        branch: { select: { id: true, name: true } },
        adjustedBy: { select: { id: true, name: true } },
      },
    });
    if (!adjustment) throw new NotFoundException('ไม่พบรายการปรับสต๊อค');
    return adjustment;
  }

  async getSummary(filters: { branchId?: string; startDate?: string; endDate?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) dateFilter.lte = new Date(filters.endDate);
      where.createdAt = dateFilter;
    }

    const adjustments = await this.prisma.stockAdjustment.findMany({
      where,
      include: {
        product: { select: { costPrice: true } },
      },
    });

    const byReason: Record<string, { count: number; totalValue: number }> = {};
    for (const adj of adjustments) {
      const reason = adj.reason;
      if (!byReason[reason]) byReason[reason] = { count: 0, totalValue: 0 };
      byReason[reason].count++;
      byReason[reason].totalValue += Number(adj.product.costPrice);
    }

    const totalCount = adjustments.length;
    const totalValue = adjustments.reduce((sum, a) => sum + Number(a.product.costPrice), 0);

    return { byReason, totalCount, totalValue };
  }
}

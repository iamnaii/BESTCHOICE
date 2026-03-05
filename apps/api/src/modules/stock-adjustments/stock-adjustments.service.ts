import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';

@Injectable()
export class StockAdjustmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateStockAdjustmentDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Find product inside transaction to prevent race conditions
      const product = await tx.product.findUnique({
        where: { id: dto.productId },
        include: { branch: { select: { id: true, name: true } } },
      });

      // FOUND: allow soft-deleted products (they need to be restored)
      if (dto.reason === 'FOUND') {
        if (!product) {
          throw new NotFoundException('ไม่พบสินค้า');
        }
        if (!product.deletedAt && product.status === 'IN_STOCK') {
          throw new BadRequestException('สินค้านี้อยู่ในสต๊อคอยู่แล้ว ไม่สามารถใช้เหตุผล "พบคืน" ได้');
        }
      } else {
        // DAMAGED, LOST, WRITE_OFF, CORRECTION, OTHER: product must exist and be in stock
        if (!product || product.deletedAt) {
          throw new NotFoundException('ไม่พบสินค้า');
        }
        const adjustableStatuses = ['IN_STOCK', 'PO_RECEIVED', 'INSPECTION', 'QC_PENDING'];
        if (!adjustableStatuses.includes(product.status)) {
          throw new BadRequestException(
            `ไม่สามารถปรับสต๊อคสินค้าสถานะ "${product.status}" ได้ (ต้องเป็น IN_STOCK, PO_RECEIVED, QC_PENDING, หรือ INSPECTION)`,
          );
        }
      }

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
          data: { status: 'IN_STOCK', deletedAt: null, stockInDate: new Date() },
        });
      } else if (['DAMAGED', 'LOST', 'WRITE_OFF'].includes(dto.reason)) {
        // DAMAGED, LOST, WRITE_OFF → soft delete (remove from active stock)
        await tx.product.update({
          where: { id: dto.productId },
          data: { deletedAt: new Date() },
        });
      }
      // CORRECTION, OTHER → record only, no status/deletion change

      return adjustment;
    });
  }

  async findAll(filters: {
    branchId?: string;
    reason?: string;
    productId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.reason) where.reason = filters.reason;
    if (filters.productId) where.productId = filters.productId;
    if (filters.search) {
      where.product = {
        is: {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { brand: { contains: filters.search, mode: 'insensitive' } },
            { model: { contains: filters.search, mode: 'insensitive' } },
            { imeiSerial: { contains: filters.search } },
          ],
        },
      };
    }
    if (filters.startDate || filters.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

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
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    // Use groupBy for efficient DB-level aggregation
    const grouped = await this.prisma.stockAdjustment.groupBy({
      by: ['reason'],
      where: where as any,
      _count: true,
    });

    // Get cost values per reason via a separate query (join with product)
    const adjustments = await this.prisma.stockAdjustment.findMany({
      where,
      select: { reason: true, product: { select: { costPrice: true } } },
    });

    const byReason: Record<string, { count: number; totalValue: number }> = {};
    for (const g of grouped) {
      byReason[g.reason] = { count: g._count, totalValue: 0 };
    }
    for (const adj of adjustments) {
      if (byReason[adj.reason]) {
        byReason[adj.reason].totalValue += Number(adj.product?.costPrice ?? 0) || 0;
      }
    }

    const totalCount = grouped.reduce((sum, g) => sum + g._count, 0);
    const totalValue = Object.values(byReason).reduce((sum, r) => sum + r.totalValue, 0);

    return { byReason, totalCount, totalValue };
  }
}

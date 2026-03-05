import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockCountDto, SubmitStockCountDto } from './dto/stock-count.dto';

@Injectable()
export class StockCountService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: { branchId?: string; status?: string; page?: number; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.status) where.status = filters.status;

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.stockCount.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          countedBy: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockCount.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const stockCount = await this.prisma.stockCount.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        countedBy: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, status: true, costPrice: true },
            },
          },
        },
      },
    });
    if (!stockCount) throw new NotFoundException('ไม่พบรายการตรวจนับ');
    return stockCount;
  }

  /**
   * Create a new stock count session for a branch
   * Auto-populates expected items from IN_STOCK products in the branch
   */
  async create(dto: CreateStockCountDto, userId: string) {
    const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('ไม่พบสาขา');

    // Generate count number: SC-YYYY-MM-NNN
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const monthStart = new Date(year, today.getMonth(), 1);
    const monthEnd = new Date(year, today.getMonth() + 1, 1);
    const monthCount = await this.prisma.stockCount.count({
      where: { createdAt: { gte: monthStart, lt: monthEnd } },
    });
    const countNumber = `SC-${year}-${month}-${String(monthCount + 1).padStart(3, '0')}`;

    // Get all products that should be in this branch
    const expectedProducts = await this.prisma.product.findMany({
      where: {
        branchId: dto.branchId,
        deletedAt: null,
        status: { in: ['IN_STOCK', 'RESERVED', 'QC_PENDING'] },
      },
      select: { id: true, status: true },
    });

    const stockCount = await this.prisma.stockCount.create({
      data: {
        countNumber,
        branchId: dto.branchId,
        countedById: userId,
        notes: dto.notes,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        items: {
          create: expectedProducts.map((p) => ({
            productId: p.id,
            expectedStatus: p.status,
            actualFound: false, // default: not yet counted
          })),
        },
      },
      include: {
        branch: { select: { id: true, name: true } },
        countedBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });

    return stockCount;
  }

  /**
   * Submit stock count results
   */
  async submit(id: string, dto: SubmitStockCountDto) {
    const stockCount = await this.findOne(id);
    if (stockCount.status === 'COMPLETED') {
      throw new BadRequestException('รายการตรวจนับนี้เสร็จสิ้นแล้ว');
    }
    if (stockCount.status === 'CANCELLED') {
      throw new BadRequestException('รายการตรวจนับนี้ถูกยกเลิกแล้ว');
    }

    return this.prisma.$transaction(async (tx) => {
      // Update each item
      for (const item of dto.items) {
        await tx.stockCountItem.updateMany({
          where: { stockCountId: id, productId: item.productId },
          data: {
            actualFound: item.actualFound,
            conditionNotes: item.conditionNotes || null,
            scannedImei: item.scannedImei || null,
          },
        });
      }

      // Mark as completed
      const updated = await tx.stockCount.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          notes: dto.notes || stockCount.notes,
        },
        include: {
          branch: { select: { id: true, name: true } },
          countedBy: { select: { id: true, name: true } },
          items: {
            include: {
              product: {
                select: { id: true, name: true, imeiSerial: true, status: true },
              },
            },
          },
        },
      });

      // Calculate variance
      const totalExpected = updated.items.length;
      const found = updated.items.filter((i) => i.actualFound).length;
      const missing = totalExpected - found;

      return {
        ...updated,
        variance: { totalExpected, found, missing },
      };
    });
  }

  /**
   * Cancel a stock count
   */
  async cancel(id: string) {
    const stockCount = await this.findOne(id);
    if (stockCount.status === 'COMPLETED') {
      throw new BadRequestException('ไม่สามารถยกเลิกรายการที่เสร็จสิ้นแล้ว');
    }

    return this.prisma.stockCount.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Get variance summary for a completed stock count
   */
  async getVariance(id: string) {
    const stockCount = await this.findOne(id);

    const totalExpected = stockCount.items.length;
    const found = stockCount.items.filter((i) => i.actualFound).length;
    const missing = stockCount.items.filter((i) => !i.actualFound);

    return {
      countNumber: stockCount.countNumber,
      branch: stockCount.branch,
      status: stockCount.status,
      totalExpected,
      found,
      missingCount: missing.length,
      missingItems: missing.map((i) => ({
        productId: i.product.id,
        name: i.product.name,
        imeiSerial: i.product.imeiSerial,
        expectedStatus: i.expectedStatus,
      })),
    };
  }
}

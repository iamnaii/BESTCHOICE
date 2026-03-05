import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateProductPriceDto, UpdateProductPriceDto } from './dto/product-price.dto';
import { TransferProductDto } from './dto/transfer-product.dto';

const productInclude = {
  prices: { orderBy: { createdAt: 'asc' as const } },
  supplier: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  po: { select: { id: true, poNumber: true } },
  inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
};

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    search?: string;
    branchId?: string;
    status?: string;
    category?: string;
    brand?: string;
    supplierId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = filters.brand;
    if (filters.supplierId) where.supplierId = filters.supplierId;

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
        { imeiSerial: { contains: filters.search } },
      ];
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    return product;
  }

  async create(dto: CreateProductDto) {
    const { prices, costPrice, warrantyExpireDate, ...data } = dto;

    const product = await this.prisma.product.create({
      data: {
        ...data,
        costPrice,
        warrantyExpireDate: warrantyExpireDate ? new Date(warrantyExpireDate) : null,
        ...(prices && prices.length > 0
          ? {
              prices: {
                create: prices.map((p, i) => ({
                  label: p.label,
                  amount: p.amount,
                  isDefault: p.isDefault ?? (i === 0),
                })),
              },
            }
          : {}),
      } as Prisma.ProductUncheckedCreateInput,
      include: productInclude,
    });

    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    const { costPrice, warrantyExpireDate, ...data } = dto;
    return this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(costPrice !== undefined ? { costPrice } : {}),
        ...(warrantyExpireDate !== undefined ? { warrantyExpireDate: warrantyExpireDate ? new Date(warrantyExpireDate) : null } : {}),
      } as Prisma.ProductUncheckedUpdateInput,
      include: productInclude,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // === Price Management ===

  async addPrice(productId: string, dto: CreateProductPriceDto) {
    await this.findOne(productId);

    return this.prisma.$transaction(async (tx) => {
      // If new price is default, unset other defaults
      if (dto.isDefault) {
        await tx.productPrice.updateMany({
          where: { productId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.productPrice.create({
        data: {
          productId,
          label: dto.label,
          amount: dto.amount,
          isDefault: dto.isDefault ?? false,
        },
      });
    });
  }

  async updatePrice(productId: string, priceId: string, dto: UpdateProductPriceDto) {
    return this.prisma.$transaction(async (tx) => {
      const price = await tx.productPrice.findFirst({
        where: { id: priceId, productId },
      });
      if (!price) throw new NotFoundException('ไม่พบราคาขาย');

      // If updating to default, unset other defaults
      if (dto.isDefault) {
        await tx.productPrice.updateMany({
          where: { productId, isDefault: true, id: { not: priceId } },
          data: { isDefault: false },
        });
      }

      return tx.productPrice.update({
        where: { id: priceId },
        data: dto,
      });
    });
  }

  async removePrice(productId: string, priceId: string) {
    return this.prisma.$transaction(async (tx) => {
      const price = await tx.productPrice.findFirst({
        where: { id: priceId, productId },
      });
      if (!price) throw new NotFoundException('ไม่พบราคาขาย');

      // Check at least 1 price remains
      const count = await tx.productPrice.count({ where: { productId } });
      if (count <= 1) {
        throw new BadRequestException('ต้องมีอย่างน้อย 1 ราคาขาย');
      }

      await tx.productPrice.delete({ where: { id: priceId } });

      // If deleted price was default, set first remaining as default
      if (price.isDefault) {
        const first = await tx.productPrice.findFirst({
          where: { productId },
          orderBy: { createdAt: 'asc' },
        });
        if (first) {
          await tx.productPrice.update({
            where: { id: first.id },
            data: { isDefault: true },
          });
        }
      }

      return { message: 'ลบราคาขายสำเร็จ' };
    });
  }

  // === Stock Transfer ===

  async transfer(productId: string, dto: TransferProductDto, userId: string) {
    const product = await this.findOne(productId);

    // Workflow enforcement: Only IN_STOCK products from Main Warehouse can be transferred
    if (product.status !== 'IN_STOCK') {
      throw new BadRequestException('ไม่สามารถโอนสินค้าที่ไม่ได้อยู่ในสถานะ IN_STOCK ได้ (ต้องผ่าน QC เข้าคลังก่อน)');
    }

    // Verify source is main warehouse
    const sourceBranch = await this.prisma.branch.findUnique({ where: { id: product.branchId } });
    if (!sourceBranch?.isMainWarehouse) {
      throw new BadRequestException('ต้องโอนสินค้าจากคลังหลักเท่านั้น');
    }

    if (product.branchId === dto.toBranchId) {
      throw new BadRequestException('สาขาปลายทางต้องไม่ใช่สาขาเดียวกับสาขาต้นทาง');
    }

    // Check for existing pending/in-transit transfer for this product
    const existingTransfer = await this.prisma.stockTransfer.findFirst({
      where: { productId, status: { in: ['PENDING', 'IN_TRANSIT'] } },
    });
    if (existingTransfer) {
      throw new BadRequestException('สินค้านี้มีรายการโอนที่รออยู่แล้ว');
    }

    // Verify destination branch exists
    const toBranch = await this.prisma.branch.findUnique({ where: { id: dto.toBranchId } });
    if (!toBranch) throw new NotFoundException('ไม่พบสาขาปลายทาง');

    // Create transfer record with PENDING status (product doesn't move yet)
    const transfer = await this.prisma.stockTransfer.create({
      data: {
        productId,
        fromBranchId: product.branchId,
        toBranchId: dto.toBranchId,
        transferredBy: userId,
        notes: dto.notes,
        status: 'PENDING',
        expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
      },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
      },
    });

    return transfer;
  }

  async getPendingTransfers(branchId?: string) {
    const where: Record<string, unknown> = { status: 'PENDING' };
    if (branchId) where.toBranchId = branchId;

    return this.prisma.stockTransfer.findMany({
      where,
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, photos: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTransferHistory(filters: {
    branchId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.branchId) {
      where.OR = [
        { fromBranchId: filters.branchId },
        { toBranchId: filters.branchId },
      ];
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
      this.prisma.stockTransfer.findMany({
        where,
        include: {
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          confirmedBy: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTransferById(transferId: string) {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id: transferId },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
        product: {
          select: {
            id: true, name: true, brand: true, model: true,
            imeiSerial: true, serialNumber: true, color: true, storage: true,
            costPrice: true, category: true, photos: true, status: true,
          },
        },
      },
    });
    if (!transfer) throw new NotFoundException('ไม่พบรายการโอน');
    return transfer;
  }

  /**
   * Dispatch transfer: PENDING → IN_TRANSIT (จัดส่งสินค้าออกจากคลัง)
   */
  async dispatchTransfer(transferId: string, userId: string, trackingNote?: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
        include: {
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true } },
          toBranch: { select: { id: true, name: true } },
        },
      });
      if (!transfer) throw new NotFoundException('ไม่พบรายการโอน');
      if (transfer.status !== 'PENDING') {
        throw new BadRequestException('รายการโอนนี้ไม่อยู่ในสถานะรอจัดส่ง');
      }

      const updatedTransfer = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: 'IN_TRANSIT',
          dispatchedById: userId,
          dispatchedAt: new Date(),
          trackingNote: trackingNote || null,
        },
        include: {
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
        },
      });

      return updatedTransfer;
    });
  }

  /**
   * Confirm transfer by branch (legacy - simple confirm without QC)
   * For the new flow, use BranchReceiving module instead
   */
  async confirmTransfer(transferId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
      });
      if (!transfer) throw new NotFoundException('ไม่พบรายการโอน');
      if (transfer.status !== 'IN_TRANSIT') {
        throw new BadRequestException('รายการโอนนี้ไม่อยู่ในสถานะ IN_TRANSIT (ต้อง dispatch จัดส่งก่อน)');
      }

      // Confirm transfer: move product to destination branch
      const updatedTransfer = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: 'CONFIRMED',
          confirmedById: userId,
          confirmedAt: new Date(),
        },
        include: {
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
        },
      });

      await tx.product.update({
        where: { id: transfer.productId },
        data: { branchId: transfer.toBranchId },
      });

      return updatedTransfer;
    });
  }

  async rejectTransfer(transferId: string, userId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
      });
      if (!transfer) throw new NotFoundException('ไม่พบรายการโอน');
      if (!['PENDING', 'IN_TRANSIT'].includes(transfer.status)) {
        throw new BadRequestException('รายการโอนนี้ไม่อยู่ในสถานะที่สามารถปฏิเสธได้');
      }

      return tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: 'REJECTED',
          confirmedById: userId,
          confirmedAt: new Date(),
          trackingNote: reason ? `REJECTED: ${reason}` : transfer.trackingNote,
        },
        include: {
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
        },
      });
    });
  }

  /**
   * Get transfers that are IN_TRANSIT (for branch to see incoming deliveries)
   */
  async getInTransitTransfers(branchId?: string) {
    const where: Record<string, unknown> = { status: 'IN_TRANSIT' };
    if (branchId) where.toBranchId = branchId;

    return this.prisma.stockTransfer.findMany({
      where,
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
        dispatchedBy: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, photos: true, status: true } },
      },
      orderBy: { dispatchedAt: 'desc' },
    });
  }

  // === Stock Overview ===

  async getStock(filters: {
    search?: string;
    branchId?: string;
    status?: string;
    category?: string;
    brand?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = filters.brand;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
        { imeiSerial: { contains: filters.search } },
      ];
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          prices: { where: { isDefault: true }, take: 1 },
        },
        orderBy: [{ branch: { name: 'asc' } }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    // Aggregate summary by branch (from DB, not from paginated results)
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const summaryWhere: Record<string, unknown> = { deletedAt: null };
    if (filters.branchId) summaryWhere.branchId = filters.branchId;
    if (filters.category) summaryWhere.category = filters.category;
    if (filters.brand) summaryWhere.brand = filters.brand;

    const summaryData = await this.prisma.product.groupBy({
      by: ['branchId', 'status'],
      where: summaryWhere as any,
      _count: true,
      _sum: { costPrice: true },
    });

    const summary = branches.map((branch) => {
      const branchRows = summaryData.filter((r) => r.branchId === branch.id);
      const totalCount = branchRows.reduce((sum, r) => sum + r._count, 0);
      const inStockRow = branchRows.find((r) => r.status === 'IN_STOCK');
      const inStock = inStockRow?._count || 0;
      const totalValue = Number(inStockRow?._sum?.costPrice || 0);
      return { branch, total: totalCount, inStock, totalValue };
    });

    return { products, total, page, limit, totalPages: Math.ceil(total / limit), summary };
  }

  // === Stock Dashboard ===

  async getStockDashboard(branchId?: string) {
    const branchFilter: Record<string, unknown> = branchId ? { branchId } : {};
    const baseWhere = { deletedAt: null, ...branchFilter };
    const now = new Date();

    // --- Parallel batch queries ---
    const [
      allProducts,
      pendingTransfers,
      newProducts,
      soldProducts,
    ] = await Promise.all([
      // All active products (for aging, breakdowns, condition grade, margin)
      this.prisma.product.findMany({
        where: baseWhere as any,
        select: {
          id: true, status: true, category: true, brand: true, model: true,
          color: true, storage: true, costPrice: true, conditionGrade: true,
          createdAt: true,
          prices: { where: { isDefault: true }, take: 1, select: { amount: true } },
        },
      }),
      // Pending transfers count
      this.prisma.stockTransfer.count({
        where: { status: 'PENDING', ...(branchId ? { toBranchId: branchId } : {}) },
      }),
      // Products created in last 6 months (stock in — includes soft-deleted to track total received volume)
      this.prisma.product.findMany({
        where: {
          createdAt: { gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
          ...branchFilter,
        },
        select: { createdAt: true },
      }),
      // Sold products last 6 months (stock out)
      this.prisma.product.findMany({
        where: {
          status: { in: ['SOLD_INSTALLMENT', 'SOLD_CASH', 'SOLD_RESELL'] },
          updatedAt: { gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
          ...branchFilter,
        },
        select: { updatedAt: true, brand: true, model: true, costPrice: true },
      }),
    ]);

    // --- 1. Stock Aging (only IN_STOCK products) ---
    const inStockProducts = allProducts.filter((p) => p.status === 'IN_STOCK');
    const agingBuckets = [
      { label: '0-30 วัน', min: 0, max: 30, count: 0, value: 0 },
      { label: '31-60 วัน', min: 31, max: 60, count: 0, value: 0 },
      { label: '61-90 วัน', min: 61, max: 90, count: 0, value: 0 },
      { label: '90+ วัน', min: 91, max: Infinity, count: 0, value: 0 },
    ];
    for (const p of inStockProducts) {
      const days = Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      const bucket = agingBuckets.find((b) => days >= b.min && days <= b.max);
      if (bucket) {
        bucket.count++;
        bucket.value += Number(p.costPrice);
      }
    }

    // --- 2. Action Required ---
    const actionRequired = {
      inspection: allProducts.filter((p) => p.status === 'INSPECTION').length,
      pendingTransfers,
      repossessed: allProducts.filter((p) => p.status === 'REPOSSESSED').length,
      agingOver90: agingBuckets[3].count,
    };

    // --- 3. Value by Status ---
    const statusMap = new Map<string, { count: number; value: number }>();
    for (const p of allProducts) {
      const entry = statusMap.get(p.status) || { count: 0, value: 0 };
      entry.count++;
      entry.value += Number(p.costPrice);
      statusMap.set(p.status, entry);
    }
    const valueByStatus = Array.from(statusMap.entries())
      .map(([status, data]) => ({ status, ...data }))
      .sort((a, b) => b.value - a.value);

    // --- 4. Category + Brand + Color + Storage Breakdown (only IN_STOCK) ---
    const groupBy = (items: typeof inStockProducts, key: 'category' | 'brand' | 'color' | 'storage') => {
      const map = new Map<string, { count: number; value: number }>();
      for (const p of items) {
        const val = p[key] || 'ไม่ระบุ';
        const entry = map.get(val) || { count: 0, value: 0 };
        entry.count++;
        entry.value += Number(p.costPrice);
        map.set(val, entry);
      }
      return Array.from(map.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.count - a.count);
    };

    const byCategory = groupBy(inStockProducts, 'category');
    const byBrand = groupBy(inStockProducts, 'brand');
    const byColor = groupBy(inStockProducts, 'color');
    const byStorage = groupBy(inStockProducts, 'storage');

    // --- 5. Stock Movement (last 6 months) ---
    const stockMovement: { month: string; in: number; out: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthLabel = start.toLocaleDateString('th-TH', { year: '2-digit', month: 'short' });

      const monthIn = newProducts.filter((p) => {
        const d = new Date(p.createdAt);
        return d >= start && d < end;
      }).length;

      const monthOut = soldProducts.filter((p) => {
        const d = new Date(p.updatedAt);
        return d >= start && d < end;
      }).length;

      stockMovement.push({ month: monthLabel, in: monthIn, out: monthOut });
    }

    // --- 6. Condition Grade Distribution (IN_STOCK only) ---
    const gradeMap = new Map<string, { count: number; value: number }>();
    for (const p of inStockProducts) {
      const grade = p.conditionGrade || 'N/A';
      const entry = gradeMap.get(grade) || { count: 0, value: 0 };
      entry.count++;
      entry.value += Number(p.costPrice);
      gradeMap.set(grade, entry);
    }
    const conditionGrade = Array.from(gradeMap.entries())
      .map(([grade, data]) => ({ grade, ...data }))
      .sort((a, b) => b.count - a.count);

    // --- 7. Stock Turnover ---
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const soldThisMonth = soldProducts.filter((p) => new Date(p.updatedAt) >= thisMonthStart).length;
    const soldLastMonth = soldProducts.filter((p) => {
      const d = new Date(p.updatedAt);
      return d >= lastMonthStart && d < thisMonthStart;
    }).length;

    // Average days in stock for sold products (approximate from all IN_STOCK)
    const totalDays = inStockProducts.reduce((sum, p) => {
      return sum + Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    }, 0);
    const avgDaysInStock = inStockProducts.length > 0 ? Math.round(totalDays / inStockProducts.length) : 0;

    // --- 8. Top Sellers (last 6 months, grouped by brand+model) ---
    const sellerMap = new Map<string, number>();
    for (const p of soldProducts) {
      const key = `${p.brand} ${p.model}`;
      sellerMap.set(key, (sellerMap.get(key) || 0) + 1);
    }
    const topSellers = Array.from(sellerMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // --- 9. Slow Movers (IN_STOCK products with longest days) ---
    const slowMovers = inStockProducts
      .map((p) => ({
        name: `${p.brand} ${p.model}`,
        days: Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
        costPrice: Number(p.costPrice),
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);

    // --- 10. Margin Overview (IN_STOCK products with default selling price) ---
    const marginItems = inStockProducts
      .filter((p) => p.prices.length > 0)
      .map((p) => {
        const cost = Number(p.costPrice);
        const sell = Number(p.prices[0].amount);
        return { cost, sell, margin: sell - cost };
      });

    const totalCost = marginItems.reduce((s, m) => s + m.cost, 0);
    const totalSell = marginItems.reduce((s, m) => s + m.sell, 0);
    const totalMargin = marginItems.reduce((s, m) => s + m.margin, 0);
    const avgMarginPct = totalCost > 0 ? Math.round((totalMargin / totalCost) * 100) : 0;

    const marginOverview = {
      totalCost,
      totalSell,
      totalMargin,
      avgMarginPct,
      avgMarginPerUnit: marginItems.length > 0 ? Math.round(totalMargin / marginItems.length) : 0,
      itemsWithPrice: marginItems.length,
    };

    return {
      stockAging: agingBuckets,
      actionRequired,
      valueByStatus,
      byCategory,
      byBrand,
      byColor,
      byStorage,
      stockMovement,
      conditionGrade,
      stockTurnover: {
        avgDaysInStock,
        soldThisMonth,
        soldLastMonth,
        currentStock: inStockProducts.length,
      },
      topSellers,
      slowMovers,
      marginOverview,
    };
  }

  // === Workflow Tracker ===

  /**
   * Get workflow status for a product showing which step it's at
   * Steps: 1.เช็ค Stock → 2.สั่งสินค้า → 3.ตรวจรับ → 4.เข้าคลัง → 5.ส่งไปสาขา → 6.สาขาเช็ครับ
   */
  async getWorkflowStatus(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        po: { select: { id: true, poNumber: true, status: true, approvedBy: { select: { name: true } } } },
        branch: { select: { id: true, name: true, isMainWarehouse: true } },
        supplier: { select: { id: true, name: true } },
        receivingItem: {
          select: {
            id: true, status: true, createdAt: true,
            receiving: { select: { receivedBy: { select: { name: true } } } },
          },
        },
      },
    });

    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    // Find transfer history
    const transfers = await this.prisma.stockTransfer.findMany({
      where: { productId },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        branchReceiving: { select: { id: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestTransfer = transfers[0] || null;

    const steps = [
      {
        step: 1,
        name: 'เช็ค Stock',
        status: 'completed' as const,
        description: 'ตรวจสอบสต๊อคก่อนสั่งซื้อ',
      },
      {
        step: 2,
        name: 'สั่งสินค้า (PO)',
        status: product.poId ? 'completed' as const : 'pending' as const,
        description: product.po ? `PO: ${product.po.poNumber} (${product.po.status})` : 'ยังไม่ได้สั่งซื้อ',
      },
      {
        step: 3,
        name: 'ตรวจรับสินค้า (QC)',
        status: product.receivingItem ? 'completed' as const : 'pending' as const,
        description: product.receivingItem
          ? `QC: ${product.receivingItem.status} (${product.receivingItem.createdAt.toLocaleDateString('th-TH')})`
          : 'ยังไม่ได้ตรวจรับ',
      },
      {
        step: 4,
        name: 'สินค้าเข้าคลัง',
        status: (['IN_STOCK', 'RESERVED', 'SOLD_INSTALLMENT', 'SOLD_CASH', 'SOLD_RESELL'].includes(product.status))
          ? 'completed' as const
          : product.status === 'QC_PENDING' ? 'in_progress' as const : 'pending' as const,
        description: product.status === 'QC_PENDING' ? 'รอยืนยัน QC เข้าคลัง' : product.status === 'IN_STOCK' ? 'อยู่ในคลัง' : product.status,
      },
      {
        step: 5,
        name: 'ส่งไปสาขา',
        status: latestTransfer
          ? latestTransfer.status === 'CONFIRMED' ? 'completed' as const
            : latestTransfer.status === 'IN_TRANSIT' ? 'in_progress' as const
            : 'pending' as const
          : 'pending' as const,
        description: latestTransfer
          ? `${latestTransfer.fromBranch.name} → ${latestTransfer.toBranch.name} (${latestTransfer.status})`
          : 'ยังไม่ได้โอนไปสาขา',
      },
      {
        step: 6,
        name: 'สาขาเช็ครับ',
        status: latestTransfer?.branchReceiving
          ? 'completed' as const
          : latestTransfer?.status === 'IN_TRANSIT' ? 'pending' as const
          : 'pending' as const,
        description: latestTransfer?.branchReceiving
          ? `ตรวจรับแล้ว (${latestTransfer.branchReceiving.status})`
          : 'ยังไม่ได้ตรวจรับที่สาขา',
      },
    ];

    let currentStep = 1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].status === 'completed' || steps[i].status === 'in_progress') {
        currentStep = steps[i].step;
        break;
      }
    }

    return {
      productId: product.id,
      productName: product.name,
      currentStep,
      status: product.status,
      branch: product.branch,
      steps,
    };
  }

  // === Get available brands for filter ===
  async getBrands() {
    const brands = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });
    return brands.map((b) => b.brand);
  }
}

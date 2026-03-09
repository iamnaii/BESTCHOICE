import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferProductDto, BulkTransferDto } from './dto/transfer-product.dto';

// Core StockTransfer select - only columns guaranteed to exist
const stockTransferSelect = {
  id: true,
  batchNumber: true,
  productId: true,
  fromBranchId: true,
  toBranchId: true,
  transferredBy: true,
  notes: true,
  status: true,
  confirmedById: true,
  confirmedAt: true,
  dispatchedById: true,
  dispatchedAt: true,
  trackingNote: true,
  expectedDeliveryDate: true,
  createdAt: true,
};

@Injectable()
export class ProductsStockService {
  private readonly logger = new Logger(ProductsStockService.name);

  constructor(private prisma: PrismaService) {}

  // === Stock Transfer ===

  private async generateBatchNumber(tx: any): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthStart = new Date(year, now.getMonth(), 1);
    const monthEnd = new Date(year, now.getMonth() + 1, 1);

    try {
      // Count distinct batch numbers this month using groupBy
      const distinctBatches = await tx.stockTransfer.groupBy({
        by: ['batchNumber'],
        where: {
          batchNumber: { not: null },
          createdAt: { gte: monthStart, lt: monthEnd },
        },
      });

      return `TRF-${year}-${month}-${String(distinctBatches.length + 1).padStart(3, '0')}`;
    } catch (error) {
      // Fallback if batch_number column doesn't exist yet (migration not applied)
      this.logger.warn('generateBatchNumber failed, using timestamp fallback', error);
      const day = String(now.getDate()).padStart(2, '0');
      const seq = String(Date.now()).slice(-4);
      return `TRF-${year}-${month}-${day}-${seq}`;
    }
  }

  async transfer(productId: string, dto: TransferProductDto, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { branch: { select: { id: true, name: true, isMainWarehouse: true } } },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    // Workflow enforcement: Only IN_STOCK products from Main Warehouse can be transferred
    if (product.status !== 'IN_STOCK') {
      throw new BadRequestException('ไม่สามารถโอนสินค้าที่ไม่ได้อยู่ในสถานะ IN_STOCK ได้ (ต้องผ่าน QC เข้าคลังก่อน)');
    }

    // Verify source is main warehouse
    if (!product.branch?.isMainWarehouse) {
      throw new BadRequestException('ต้องโอนสินค้าจากคลังหลักเท่านั้น');
    }

    if (product.branchId === dto.toBranchId) {
      throw new BadRequestException('สาขาปลายทางต้องไม่ใช่สาขาเดียวกับสาขาต้นทาง');
    }

    // Check for existing pending/in-transit transfer for this product
    const existingTransfer = await this.prisma.stockTransfer.findFirst({
      where: { productId, status: { in: ['PENDING', 'IN_TRANSIT'] } },
      select: { id: true },
    });
    if (existingTransfer) {
      throw new BadRequestException('สินค้านี้มีรายการโอนที่รออยู่แล้ว');
    }

    // Verify destination branch exists
    const toBranch = await this.prisma.branch.findUnique({ where: { id: dto.toBranchId } });
    if (!toBranch) throw new NotFoundException('ไม่พบสาขาปลายทาง');

    // Create transfer record with PENDING status (product doesn't move yet)
    const transfer = await this.prisma.$transaction(async (tx) => {
      const batchNumber = await this.generateBatchNumber(tx);

      return tx.stockTransfer.create({
        data: {
          batchNumber,
          productId,
          fromBranchId: product.branchId,
          toBranchId: dto.toBranchId,
          transferredBy: userId,
          notes: dto.notes,
          status: 'PENDING',
          expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
        },
        select: {
          ...stockTransferSelect,
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
        },
      });
    });

    return transfer;
  }

  async bulkTransfer(dto: BulkTransferDto, userId: string) {
    // Verify destination branch exists
    const toBranch = await this.prisma.branch.findUnique({ where: { id: dto.toBranchId } });
    if (!toBranch) throw new NotFoundException('ไม่พบสาขาปลายทาง');

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Load all products
        const products = await tx.product.findMany({
          where: { id: { in: dto.productIds }, deletedAt: null },
          include: { branch: { select: { id: true, name: true, isMainWarehouse: true } } },
        });

        if (products.length !== dto.productIds.length) {
          const foundIds = new Set(products.map(p => p.id));
          const missing = dto.productIds.filter(id => !foundIds.has(id));
          throw new NotFoundException(`ไม่พบสินค้า: ${missing.join(', ')}`);
        }

        // Validate all products
        const errors: string[] = [];
        for (const product of products) {
          if (product.status !== 'IN_STOCK') {
            errors.push(`${product.brand} ${product.model} - สถานะไม่ใช่ IN_STOCK`);
          } else if (!product.branch.isMainWarehouse) {
            errors.push(`${product.brand} ${product.model} - ไม่ได้อยู่คลังหลัก`);
          } else if (product.branchId === dto.toBranchId) {
            errors.push(`${product.brand} ${product.model} - อยู่สาขาปลายทางอยู่แล้ว`);
          }
        }
        if (errors.length > 0) {
          throw new BadRequestException(`ไม่สามารถโอนได้:\n${errors.join('\n')}`);
        }

        // Check for existing pending/in-transit transfers
        const existingTransfers = await tx.stockTransfer.findMany({
          where: { productId: { in: dto.productIds }, status: { in: ['PENDING', 'IN_TRANSIT'] } },
          select: { id: true, product: { select: { brand: true, model: true } } },
        });
        if (existingTransfers.length > 0) {
          const names = existingTransfers.map(t => `${t.product.brand} ${t.product.model}`);
          throw new BadRequestException(`สินค้ามีรายการโอนรออยู่แล้ว: ${names.join(', ')}`);
        }

        // Generate batch number for this transfer group
        const batchNumber = await this.generateBatchNumber(tx);

        // Create transfer records sequentially to avoid transaction serialization errors
        const transfers: any[] = [];
        for (const product of products) {
          const transfer = await tx.stockTransfer.create({
            data: {
              batchNumber,
              productId: product.id,
              fromBranchId: product.branchId,
              toBranchId: dto.toBranchId,
              transferredBy: userId,
              notes: dto.notes,
              status: 'PENDING',
            },
            select: {
              ...stockTransferSelect,
              fromBranch: { select: { id: true, name: true } },
              toBranch: { select: { id: true, name: true } },
              product: { select: { id: true, brand: true, model: true, imeiSerial: true } },
            },
          });
          transfers.push(transfer);
        }

        return { batchNumber, transfers, count: transfers.length };
      }, { timeout: 15000 });
    } catch (error) {
      // Re-throw HttpExceptions (BadRequest, NotFound, Forbidden, etc.) as-is
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('bulkTransfer failed', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`โอนสินค้าไม่สำเร็จ: ${message}`);
    }
  }

  async getPendingTransfers(branchId?: string) {
    const where: Record<string, unknown> = { status: 'PENDING' };
    if (branchId) where.toBranchId = branchId;

    return this.prisma.stockTransfer.findMany({
      where,
      select: {
        ...stockTransferSelect,
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
        dispatchedBy: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, color: true, storage: true, photos: true, status: true } },
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
        select: {
          ...stockTransferSelect,
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          confirmedBy: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, color: true, storage: true, photos: true, status: true } },
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
      select: {
        ...stockTransferSelect,
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
        dispatchedBy: { select: { id: true, name: true } },
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
   * Dispatch transfer: PENDING -> IN_TRANSIT
   */
  async dispatchTransfer(transferId: string, userId: string, trackingNote?: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
        select: {
          ...stockTransferSelect,
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
        select: {
          ...stockTransferSelect,
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          dispatchedBy: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, color: true, storage: true, photos: true, status: true } },
        },
      });

      return updatedTransfer;
    });
  }

  /**
   * Confirm transfer by branch (legacy - simple confirm without QC)
   */
  async confirmTransfer(transferId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
        select: { id: true, status: true, productId: true, toBranchId: true },
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
        select: {
          ...stockTransferSelect,
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          confirmedBy: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, color: true, storage: true, photos: true, status: true } },
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
        select: { id: true, status: true, trackingNote: true },
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
        select: {
          ...stockTransferSelect,
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, photos: true, status: true } },
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
      select: {
        ...stockTransferSelect,
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
        dispatchedBy: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, color: true, storage: true, photos: true, status: true } },
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
          color: true, storage: true, costPrice: true,
          createdAt: true, stockInDate: true,
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
      const refDate = p.stockInDate ? new Date(p.stockInDate) : new Date(p.createdAt);
      const days = Math.floor((now.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
      const bucket = agingBuckets.find((b) => days >= b.min && days <= b.max);
      if (bucket) {
        bucket.count++;
        bucket.value += Number(p.costPrice);
      }
    }

    // --- 2. Action Required ---
    const actionRequired = {
      inspection: allProducts.filter((p) => p.status === 'INSPECTION').length,
      qcPending: allProducts.filter((p) => p.status === 'QC_PENDING').length,
      photoPending: allProducts.filter((p) => p.status === 'PHOTO_PENDING').length,
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

    // --- 6. Stock Turnover ---
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const soldThisMonth = soldProducts.filter((p) => new Date(p.updatedAt) >= thisMonthStart).length;
    const soldLastMonth = soldProducts.filter((p) => {
      const d = new Date(p.updatedAt);
      return d >= lastMonthStart && d < thisMonthStart;
    }).length;

    // Average days in stock (from stockInDate or createdAt as fallback)
    const totalDays = inStockProducts.reduce((sum, p) => {
      const refDate = p.stockInDate ? new Date(p.stockInDate) : new Date(p.createdAt);
      return sum + Math.floor((now.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
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
        days: Math.floor((now.getTime() - new Date(p.stockInDate || p.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
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

  // === Stock Reservation ===

  /**
   * Reserve a product (link to contract/sale in progress)
   */
  async reserve(productId: string, _reason?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        prices: { orderBy: { createdAt: 'asc' as const } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true } },
        inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    if (product.status !== 'IN_STOCK') {
      throw new BadRequestException('สามารถจองได้เฉพาะสินค้าที่อยู่ IN_STOCK เท่านั้น');
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: 'RESERVED' },
      include: {
        prices: { orderBy: { createdAt: 'asc' as const } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true } },
        inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });
  }

  /**
   * Unreserve a product (release back to IN_STOCK)
   */
  async unreserve(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        prices: { orderBy: { createdAt: 'asc' as const } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true } },
        inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    if (product.status !== 'RESERVED') {
      throw new BadRequestException('สินค้านี้ไม่ได้อยู่ในสถานะ RESERVED');
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: 'IN_STOCK' },
      include: {
        prices: { orderBy: { createdAt: 'asc' as const } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true } },
        inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });
  }

  // === Warranty Alerts ===

  /**
   * Get products with warranty expiring soon
   */
  async getWarrantyExpiring(daysAhead: number = 30, branchId?: string) {
    const now = new Date();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysAhead);

    const where: Record<string, unknown> = {
      deletedAt: null,
      warrantyExpired: false,
      warrantyExpireDate: { gte: now, lte: deadline },
      status: { in: ['IN_STOCK', 'RESERVED'] },
    };
    if (branchId) where.branchId = branchId;

    const products = await this.prisma.product.findMany({
      where: where as any,
      include: {
        branch: { select: { id: true, name: true } },
        prices: { where: { isDefault: true }, take: 1 },
      },
      orderBy: { warrantyExpireDate: 'asc' },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      model: p.model,
      imeiSerial: p.imeiSerial,
      branch: p.branch,
      warrantyExpireDate: p.warrantyExpireDate,
      daysRemaining: Math.ceil(
        (new Date(p.warrantyExpireDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      ),
      sellingPrice: p.prices[0] ? Number(p.prices[0].amount) : null,
    }));
  }

  // === Supplier Performance ===

  /**
   * Get supplier performance metrics (rejection rate, delivery on-time, etc.)
   */
  async getSupplierPerformance() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    const results: {
      supplier: { id: string; name: string };
      poCount: number;
      totalOrdered: number;
      totalReceived: number;
      fulfillmentRate: number;
      totalPassed: number;
      totalRejected: number;
      qualityRate: number;
      onTimeRate: number;
      deliveredCount: number;
    }[] = [];

    for (const supplier of suppliers) {
      // Get all POs for this supplier
      const pos = await this.prisma.purchaseOrder.findMany({
        where: { supplierId: supplier.id, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        select: {
          id: true, status: true, orderDate: true, expectedDate: true,
          items: { select: { quantity: true, receivedQty: true } },
          goodsReceivings: {
            select: {
              createdAt: true,
              items: { select: { status: true } },
            },
          },
        },
      });

      if (pos.length === 0) continue;

      let totalOrdered = 0;
      let totalReceived = 0;
      let totalPassed = 0;
      let totalRejected = 0;
      let onTimeCount = 0;
      let deliveredCount = 0;

      for (const po of pos) {
        totalOrdered += po.items.reduce((sum, i) => sum + i.quantity, 0);
        totalReceived += po.items.reduce((sum, i) => sum + i.receivedQty, 0);

        for (const gr of po.goodsReceivings) {
          for (const item of gr.items) {
            if (item.status === 'PASS') totalPassed++;
            if (item.status === 'REJECT') totalRejected++;
          }

          // Check if delivered on time
          if (po.expectedDate) {
            deliveredCount++;
            if (new Date(gr.createdAt) <= new Date(po.expectedDate)) {
              onTimeCount++;
            }
          }
        }
      }

      const totalInspected = totalPassed + totalRejected;
      results.push({
        supplier,
        poCount: pos.length,
        totalOrdered,
        totalReceived,
        fulfillmentRate: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0,
        totalPassed,
        totalRejected,
        qualityRate: totalInspected > 0 ? Math.round((totalPassed / totalInspected) * 100) : 100,
        onTimeRate: deliveredCount > 0 ? Math.round((onTimeCount / deliveredCount) * 100) : 0,
        deliveredCount,
      });
    }

    return results.sort((a, b) => b.poCount - a.poCount);
  }
}

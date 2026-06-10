import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, InternalServerErrorException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TransferProductDto, BulkTransferDto } from '../dto/transfer-product.dto';

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
  deletedAt: true,
};

@Injectable()
export class StockTransferService {
  private readonly logger = new Logger(StockTransferService.name);

  constructor(private prisma: PrismaService) {}

  // === Stock Transfer ===

  private async generateBatchNumber(tx: Prisma.TransactionClient): Promise<string> {
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
    // Verify destination branch exists (safe to check outside transaction)
    const toBranch = await this.prisma.branch.findUnique({ where: { id: dto.toBranchId } });
    if (!toBranch || toBranch.deletedAt) throw new NotFoundException('ไม่พบสาขาปลายทาง');

    // All validation + creation inside transaction to prevent race conditions
    const transfer = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        include: { branch: { select: { id: true, name: true, isMainWarehouse: true } } },
      });
      if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

      if (product.status !== 'IN_STOCK') {
        throw new BadRequestException('ไม่สามารถโอนสินค้าที่ไม่ได้อยู่ในสถานะ IN_STOCK ได้ (ต้องผ่าน QC เข้าคลังก่อน)');
      }
      if (!product.branch?.isMainWarehouse) {
        throw new BadRequestException('ต้องโอนสินค้าจากคลังหลักเท่านั้น');
      }
      if (product.branchId === dto.toBranchId) {
        throw new BadRequestException('สาขาปลายทางต้องไม่ใช่สาขาเดียวกับสาขาต้นทาง');
      }

      // Duplicate check INSIDE transaction to prevent race condition
      const existingTransfer = await tx.stockTransfer.findFirst({
        where: { productId, status: { in: ['PENDING', 'IN_TRANSIT'] } },
        select: { id: true },
      });
      if (existingTransfer) {
        throw new BadRequestException('สินค้านี้มีรายการโอนที่รออยู่แล้ว');
      }

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
    if (!toBranch || toBranch.deletedAt) throw new NotFoundException('ไม่พบสาขาปลายทาง');

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const where: Record<string, unknown> = { status: 'PENDING', deletedAt: null };
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
    const where: Record<string, unknown> = { deletedAt: null };
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

  async getTransferById(transferId: string, user?: { role: string; branchId: string | null }) {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id: transferId },
      select: {
        ...stockTransferSelect,
        fromBranchId: true,
        toBranchId: true,
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
    if (!transfer || transfer.deletedAt) throw new NotFoundException('ไม่พบรายการโอน');

    // Branch-level access: non-OWNER/ACCOUNTANT can only see transfers involving their branch
    if (user && user.role !== 'OWNER' && user.role !== 'ACCOUNTANT' && user.branchId) {
      if (transfer.fromBranchId !== user.branchId && transfer.toBranchId !== user.branchId) {
        throw new ForbiddenException('ไม่สามารถดูรายการโอนข้ามสาขาได้');
      }
    }

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
      if (!transfer || transfer.deletedAt) throw new NotFoundException('ไม่พบรายการโอน');
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
        select: { id: true, status: true, productId: true, toBranchId: true, deletedAt: true },
      });
      if (!transfer || transfer.deletedAt) throw new NotFoundException('ไม่พบรายการโอน');
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
        select: { id: true, status: true, trackingNote: true, deletedAt: true },
      });
      if (!transfer || transfer.deletedAt) throw new NotFoundException('ไม่พบรายการโอน');
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
    const where: Record<string, unknown> = { status: 'IN_TRANSIT', deletedAt: null };
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
}

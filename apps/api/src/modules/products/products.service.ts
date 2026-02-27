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

    const page = filters.page || 1;
    const limit = filters.limit || 50;

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

    // If new price is default, unset other defaults
    if (dto.isDefault) {
      await this.prisma.productPrice.updateMany({
        where: { productId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.productPrice.create({
      data: {
        productId,
        label: dto.label,
        amount: dto.amount,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async updatePrice(productId: string, priceId: string, dto: UpdateProductPriceDto) {
    const price = await this.prisma.productPrice.findFirst({
      where: { id: priceId, productId },
    });
    if (!price) throw new NotFoundException('ไม่พบราคาขาย');

    // If updating to default, unset other defaults
    if (dto.isDefault) {
      await this.prisma.productPrice.updateMany({
        where: { productId, isDefault: true, id: { not: priceId } },
        data: { isDefault: false },
      });
    }

    return this.prisma.productPrice.update({
      where: { id: priceId },
      data: dto,
    });
  }

  async removePrice(productId: string, priceId: string) {
    const price = await this.prisma.productPrice.findFirst({
      where: { id: priceId, productId },
    });
    if (!price) throw new NotFoundException('ไม่พบราคาขาย');

    // Check at least 1 price remains
    const count = await this.prisma.productPrice.count({ where: { productId } });
    if (count <= 1) {
      throw new BadRequestException('ต้องมีอย่างน้อย 1 ราคาขาย');
    }

    await this.prisma.productPrice.delete({ where: { id: priceId } });

    // If deleted price was default, set first remaining as default
    if (price.isDefault) {
      const first = await this.prisma.productPrice.findFirst({
        where: { productId },
        orderBy: { createdAt: 'asc' },
      });
      if (first) {
        await this.prisma.productPrice.update({
          where: { id: first.id },
          data: { isDefault: true },
        });
      }
    }

    return { message: 'ลบราคาขายสำเร็จ' };
  }

  // === Stock Transfer ===

  async transfer(productId: string, dto: TransferProductDto, userId: string) {
    const product = await this.findOne(productId);

    if (product.branchId === dto.toBranchId) {
      throw new BadRequestException('สาขาปลายทางต้องไม่ใช่สาขาเดียวกับสาขาต้นทาง');
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
      if (filters.endDate) dateFilter.lte = new Date(filters.endDate);
      where.createdAt = dateFilter;
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;

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

  async confirmTransfer(transferId: string, userId: string) {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id: transferId },
    });
    if (!transfer) throw new NotFoundException('ไม่พบรายการโอน');
    if (transfer.status !== 'PENDING') {
      throw new BadRequestException('รายการโอนนี้ไม่อยู่ในสถานะรอยืนยัน');
    }

    // Confirm transfer: move product to destination branch
    const [updatedTransfer] = await this.prisma.$transaction([
      this.prisma.stockTransfer.update({
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
      }),
      this.prisma.product.update({
        where: { id: transfer.productId },
        data: { branchId: transfer.toBranchId },
      }),
    ]);

    return updatedTransfer;
  }

  async rejectTransfer(transferId: string, userId: string) {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id: transferId },
    });
    if (!transfer) throw new NotFoundException('ไม่พบรายการโอน');
    if (transfer.status !== 'PENDING') {
      throw new BadRequestException('รายการโอนนี้ไม่อยู่ในสถานะรอยืนยัน');
    }

    return this.prisma.stockTransfer.update({
      where: { id: transferId },
      data: {
        status: 'REJECTED',
        confirmedById: userId,
        confirmedAt: new Date(),
      },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
      },
    });
  }

  // === Stock Overview ===

  async getStock(filters: {
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

    const page = filters.page || 1;
    const limit = filters.limit || 50;

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

    const summaryData = await this.prisma.product.groupBy({
      by: ['branchId', 'status'],
      where: { deletedAt: null, ...(filters.category ? { category: filters.category as any } : {}), ...(filters.brand ? { brand: filters.brand } : {}) },
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

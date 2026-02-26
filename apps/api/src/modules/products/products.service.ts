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
    const { prices, costPrice, ...data } = dto;

    const product = await this.prisma.product.create({
      data: {
        ...data,
        costPrice,
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
    const { costPrice, ...data } = dto;
    return this.prisma.product.update({
      where: { id },
      data: { ...data, ...(costPrice !== undefined ? { costPrice } : {}) } as Prisma.ProductUncheckedUpdateInput,
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

    // Create transfer record and update product branch
    const [transfer] = await this.prisma.$transaction([
      this.prisma.stockTransfer.create({
        data: {
          productId,
          fromBranchId: product.branchId,
          toBranchId: dto.toBranchId,
          transferredBy: userId,
          notes: dto.notes,
        },
      }),
      this.prisma.product.update({
        where: { id: productId },
        data: { branchId: dto.toBranchId },
      }),
    ]);

    return transfer;
  }

  // === Stock Overview ===

  async getStock(filters: { branchId?: string; status?: string; category?: string; brand?: string }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = filters.brand;

    const products = await this.prisma.product.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        prices: { where: { isDefault: true }, take: 1 },
      },
      orderBy: [{ branch: { name: 'asc' } }, { createdAt: 'desc' }],
    });

    // Aggregate summary by branch
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const summary = branches.map((branch) => {
      const branchProducts = products.filter((p) => p.branchId === branch.id);
      const inStock = branchProducts.filter((p) => p.status === 'IN_STOCK').length;
      const totalValue = branchProducts
        .filter((p) => p.status === 'IN_STOCK')
        .reduce((sum, p) => sum + Number(p.costPrice), 0);
      return {
        branch,
        total: branchProducts.length,
        inStock,
        totalValue,
      };
    });

    return { products, summary };
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

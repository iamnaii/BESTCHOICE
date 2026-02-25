import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: { role: string; branchId: string | null }, query: { status?: string; category?: string; search?: string }) {
    const where: any = { deletedAt: null };

    if (user.role !== 'OWNER' && user.role !== 'ACCOUNTANT' && user.branchId) {
      where.branchId = user.branchId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { brand: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
        { imeiSerial: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.product.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        prices: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        prices: true,
        contracts: {
          select: { id: true, contractNumber: true, status: true },
          where: { deletedAt: null },
        },
      },
    });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');
    return product;
  }

  async create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        name: dto.name,
        brand: dto.brand,
        model: dto.model,
        imeiSerial: dto.imeiSerial,
        category: dto.category as any,
        costPrice: dto.costPrice,
        supplierId: dto.supplierId,
        branchId: dto.branchId,
        conditionGrade: dto.conditionGrade as any,
        photos: dto.photos || [],
        status: 'IN_STOCK',
      },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: dto as any,
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

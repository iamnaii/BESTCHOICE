import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll(search?: string, isActive?: string) {
    const where: Record<string, unknown> = {};

    if (isActive === 'true') {
      where.isActive = true;
    } else if (isActive === 'false') {
      where.isActive = false;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { taxId: { contains: search } },
      ];
    }

    return this.prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { products: true, purchaseOrders: true } },
      },
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true, purchaseOrders: true } },
      },
    });
    if (!supplier) throw new NotFoundException('ไม่พบ Supplier');
    return supplier;
  }

  async create(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: dto });
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getPurchaseHistory(id: string) {
    await this.findOne(id);

    const products = await this.prisma.product.findMany({
      where: { supplierId: id },
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        imeiSerial: true,
        category: true,
        costPrice: true,
        status: true,
        conditionGrade: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true, orderDate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: { supplierId: id },
      select: {
        id: true,
        poNumber: true,
        orderDate: true,
        expectedDate: true,
        status: true,
        totalAmount: true,
        notes: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
        items: true,
        _count: { select: { products: true } },
      },
      orderBy: { orderDate: 'desc' },
    });

    return { products, purchaseOrders };
  }
}

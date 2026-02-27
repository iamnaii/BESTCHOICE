import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll(search?: string, isActive?: string, page = 1, limit = 50) {
    const andConditions: Record<string, unknown>[] = [];

    if (isActive === 'true') {
      andConditions.push({ isActive: true });
    } else if (isActive === 'false') {
      andConditions.push({ isActive: false });
    }

    if (search) {
      const orConditions: Record<string, unknown>[] = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { nickname: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { taxId: { contains: search } },
      ];

      // Also match phone with/without dash formatting
      const digits = search.replace(/\D/g, '');
      if (digits.length >= 3) {
        const formatted =
          digits.length <= 3
            ? digits
            : digits.length <= 6
              ? `${digits.slice(0, 3)}-${digits.slice(3)}`
              : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
        if (formatted !== search) {
          orConditions.push({ phone: { contains: formatted } });
        }
      }

      andConditions.push({ OR: orConditions });
    }

    const where =
      andConditions.length > 0 ? { AND: andConditions } : {};

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { products: true, purchaseOrders: true } },
        },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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
        paymentStatus: true,
        paymentMethod: true,
        paidAmount: true,
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('ไม่พบ Supplier');
    return supplier;
  }

  async create(data: { name: string; contactName: string; phone: string; phoneSecondary?: string; lineId?: string; address?: string; taxId?: string; notes?: string }) {
    return this.prisma.supplier.create({ data });
  }

  async update(id: string, data: Partial<{ name: string; contactName: string; phone: string; phoneSecondary: string; lineId: string; address: string; taxId: string; notes: string; isActive: boolean }>) {
    await this.findOne(id);
    return this.prisma.supplier.update({ where: { id }, data });
  }
}

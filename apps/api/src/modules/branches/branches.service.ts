import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: { role: string; branchId: string | null }) {
    if (user.role === 'OWNER' || user.role === 'ACCOUNTANT') {
      return this.prisma.branch.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { users: true, products: true, contracts: true } } },
      });
    }
    if (!user.branchId) return [];
    return this.prisma.branch.findMany({
      where: { id: user.branchId },
      include: { _count: { select: { users: true, products: true, contracts: true } } },
    });
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, isActive: true },
        },
        _count: { select: { products: true, contracts: true } },
      },
    });
    if (!branch) throw new NotFoundException('ไม่พบสาขา');
    return branch;
  }

  async create(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);

    // If setting as main warehouse, unset any existing main warehouse first
    if (dto.isMainWarehouse) {
      await this.prisma.branch.updateMany({
        where: { isMainWarehouse: true, id: { not: id } },
        data: { isMainWarehouse: false },
      });
    }

    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

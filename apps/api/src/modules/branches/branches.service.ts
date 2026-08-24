import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: { role: string; branchId: string | null }) {
    if (hasCrossBranchAccess(user)) {
      return this.prisma.branch.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        include: { _count: { select: { users: true, products: true, contracts: true } } },
      });
    }
    if (!user.branchId) return [];
    return this.prisma.branch.findMany({
      where: { id: user.branchId, deletedAt: null },
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
    if (!branch || branch.deletedAt) throw new NotFoundException('ไม่พบสาขา');
    return branch;
  }

  async create(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);

    // DTO ตรวจได้แค่ "รูปแบบ" ของสองฟิลด์นี้ — ต้องยืนยันว่ามีอยู่จริงในฐานข้อมูลด้วย
    // ไม่งั้นจะตั้งค่าที่ทำให้ flow ปลายทางพังตอนใช้งานจริงแทนที่จะพังตอนตั้งค่า
    if (dto.companyId) {
      const company = await this.prisma.companyInfo.findFirst({
        where: { id: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!company) throw new NotFoundException('ไม่พบบริษัทที่ระบุ');
    }

    if (dto.shopCashAccountCode) {
      const account = await this.prisma.chartOfAccount.findFirst({
        where: { code: dto.shopCashAccountCode, status: 'ใช้งาน', deletedAt: null },
        select: { code: true },
      });
      if (!account) {
        throw new NotFoundException(
          `ไม่พบบัญชี ${dto.shopCashAccountCode} ในผังบัญชี — ถ้าเพิ่งเพิ่มบัญชีใหม่ ให้รัน seed:coa ก่อน`,
        );
      }
    }

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
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}

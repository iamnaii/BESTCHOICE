import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FilterPresetScope, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePresetDto } from './dto/create-preset.dto';

const BRANCH_SHARE_ROLES = new Set(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']);

@Injectable()
export class FilterPresetsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePresetDto, userId: string, userRole?: string, userBranchId?: string | null) {
    if (dto.scope === FilterPresetScope.SHARED_ALL && userRole !== 'OWNER') {
      throw new ForbiddenException('ไม่มีสิทธิ์สร้าง preset สำหรับทุกสาขา');
    }
    if (dto.scope === FilterPresetScope.SHARED_BRANCH && !BRANCH_SHARE_ROLES.has(userRole ?? '')) {
      throw new ForbiddenException('ไม่มีสิทธิ์สร้าง preset สำหรับทั้งสาขา');
    }

    // SHARED_BRANCH must have branchId — fall back to user's branch when not provided.
    // PRIVATE / SHARED_ALL never carry a branchId.
    let branchId: string | undefined;
    if (dto.scope === FilterPresetScope.SHARED_BRANCH) {
      branchId = dto.branchId ?? userBranchId ?? undefined;
      if (!branchId) {
        throw new ForbiddenException('preset SHARED_BRANCH ต้องระบุสาขา');
      }
    }

    return this.prisma.filterPreset.create({
      data: {
        name: dto.name,
        scope: dto.scope,
        page: dto.page,
        filterJson: dto.filterJson as Prisma.InputJsonValue,
        branchId,
        ownerUserId: userId,
      },
    });
  }

  async list({
    userId,
    userRole,
    branchId,
    page,
  }: {
    userId: string;
    userRole: string;
    branchId: string | null;
    page: string;
  }) {
    const visibility: Prisma.FilterPresetWhereInput[] = [
      { scope: FilterPresetScope.PRIVATE, ownerUserId: userId },
      { scope: FilterPresetScope.SHARED_ALL },
    ];
    if (branchId) {
      visibility.push({ scope: FilterPresetScope.SHARED_BRANCH, branchId });
    }
    // OWNER sees every SHARED_BRANCH preset (even outside their branch)
    if (userRole === 'OWNER') {
      visibility.push({ scope: FilterPresetScope.SHARED_BRANCH });
    }

    return this.prisma.filterPreset.findMany({
      where: {
        page,
        deletedAt: null,
        OR: visibility,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(id: string, userId: string, userRole: string) {
    const preset = await this.prisma.filterPreset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!preset) {
      throw new NotFoundException('ไม่พบ preset');
    }
    if (preset.ownerUserId !== userId && userRole !== 'OWNER') {
      throw new ForbiddenException('ลบได้เฉพาะ preset ของตนเอง');
    }
    return this.prisma.filterPreset.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

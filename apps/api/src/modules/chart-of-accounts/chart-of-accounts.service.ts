import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { AccountGroup } from '@prisma/client';

@Injectable()
export class ChartOfAccountsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter?: {
    group?: AccountGroup;
    active?: boolean;
    q?: string;
    companyId?: string | 'SHARED' | null;
  }) {
    const companyFilter =
      filter?.companyId === 'SHARED'
        ? { companyId: null }
        : filter?.companyId
          ? { companyId: filter.companyId }
          : {};

    return this.prisma.chartOfAccount.findMany({
      where: {
        deletedAt: null,
        ...companyFilter,
        ...(filter?.group && { accountGroup: filter.group }),
        ...(filter?.active != null && { isActive: filter.active }),
        ...(filter?.q && {
          OR: [
            { code: { contains: filter.q, mode: 'insensitive' } },
            { nameTh: { contains: filter.q, mode: 'insensitive' } },
            { nameEn: { contains: filter.q, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: [{ companyId: 'asc' }, { code: 'asc' }],
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.chartOfAccount.findUnique({ where: { id, deletedAt: null } });
    if (!account) throw new NotFoundException('ไม่พบบัญชี');
    return account;
  }

  async create(dto: CreateChartOfAccountDto) {
    const companyId = dto.companyId ?? null;

    // Composite uniqueness check
    const exists = await this.prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId: companyId as any, code: dto.code } },
    });
    if (exists) throw new ConflictException(`รหัสบัญชี ${dto.code} มีอยู่แล้วในบริษัทนี้`);

    if (dto.parentCode) {
      const parent = await this.prisma.chartOfAccount.findFirst({
        where: { code: dto.parentCode, companyId, deletedAt: null },
      });
      if (!parent) throw new BadRequestException(`ไม่พบบัญชีแม่ ${dto.parentCode} ในบริษัทเดียวกัน`);
    }

    return this.prisma.chartOfAccount.create({
      data: {
        code: dto.code,
        companyId,
        nameTh: dto.nameTh,
        nameEn: dto.nameEn,
        accountGroup: dto.accountGroup,
        parentCode: dto.parentCode,
        level: dto.level ?? 3,
        isActive: dto.isActive ?? true,
        peakAccountCode: dto.peakAccountCode ?? dto.code,
        peakAccountId: dto.peakAccountId,
      },
    });
  }

  async update(id: string, dto: UpdateChartOfAccountDto) {
    await this.findOne(id);
    if (dto.parentCode) {
      // For update, must verify parent exists in the same company as the existing account
      const existing = await this.prisma.chartOfAccount.findUnique({ where: { id } });
      const parent = await this.prisma.chartOfAccount.findFirst({
        where: { code: dto.parentCode, companyId: existing?.companyId ?? null, deletedAt: null },
      });
      if (!parent) throw new BadRequestException(`ไม่พบบัญชีแม่ ${dto.parentCode} ในบริษัทเดียวกัน`);
    }
    // Strip undefined so they don't overwrite existing
    const data: any = {};
    if (dto.nameTh !== undefined) data.nameTh = dto.nameTh;
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
    if (dto.accountGroup !== undefined) data.accountGroup = dto.accountGroup;
    if (dto.parentCode !== undefined) data.parentCode = dto.parentCode;
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.peakAccountCode !== undefined) data.peakAccountCode = dto.peakAccountCode;
    if (dto.peakAccountId !== undefined) data.peakAccountId = dto.peakAccountId;
    // Note: companyId NOT updatable — moving accounts between companies is intentional rare op (do via delete+recreate)
    return this.prisma.chartOfAccount.update({ where: { id }, data });
  }

  async remove(id: string) {
    const account = await this.findOne(id);

    // Block delete if any journal lines reference this code
    const used = await this.prisma.journalLine.count({ where: { accountCode: account.code } });
    if (used > 0) {
      // Soft-disable instead of hard-delete to preserve history
      return this.prisma.chartOfAccount.update({ where: { id }, data: { isActive: false } });
    }

    // Block delete if any child accounts exist
    const children = await this.prisma.chartOfAccount.count({
      where: { parentCode: account.code, companyId: account.companyId },
    });
    if (children > 0) {
      throw new BadRequestException('มีบัญชีย่อยอยู่ ลบไม่ได้');
    }

    return this.prisma.chartOfAccount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

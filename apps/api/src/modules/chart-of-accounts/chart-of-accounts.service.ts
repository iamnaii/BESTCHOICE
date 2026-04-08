import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { AccountGroup } from '@prisma/client';

@Injectable()
export class ChartOfAccountsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter?: { group?: AccountGroup; active?: boolean; q?: string }) {
    return this.prisma.chartOfAccount.findMany({
      where: {
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
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.chartOfAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('ไม่พบบัญชี');
    return account;
  }

  async create(dto: CreateChartOfAccountDto) {
    const exists = await this.prisma.chartOfAccount.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException(`รหัสบัญชี ${dto.code} มีอยู่แล้ว`);

    if (dto.parentCode) {
      const parent = await this.prisma.chartOfAccount.findUnique({ where: { code: dto.parentCode } });
      if (!parent) throw new BadRequestException(`ไม่พบบัญชีแม่ ${dto.parentCode}`);
    }

    return this.prisma.chartOfAccount.create({
      data: {
        code: dto.code,
        nameTh: dto.nameTh,
        nameEn: dto.nameEn,
        accountGroup: dto.accountGroup,
        parentCode: dto.parentCode,
        level: dto.level ?? 3,
        isActive: dto.isActive ?? true,
        allowedCompanies: dto.allowedCompanies ?? [],
        peakAccountCode: dto.peakAccountCode ?? dto.code,
        peakAccountId: dto.peakAccountId,
      },
    });
  }

  async update(id: string, dto: UpdateChartOfAccountDto) {
    await this.findOne(id);
    if (dto.parentCode) {
      const parent = await this.prisma.chartOfAccount.findUnique({ where: { code: dto.parentCode } });
      if (!parent) throw new BadRequestException(`ไม่พบบัญชีแม่ ${dto.parentCode}`);
    }
    return this.prisma.chartOfAccount.update({ where: { id }, data: dto });
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
    const children = await this.prisma.chartOfAccount.count({ where: { parentCode: account.code } });
    if (children > 0) {
      throw new BadRequestException('มีบัญชีย่อยอยู่ ลบไม่ได้');
    }

    return this.prisma.chartOfAccount.delete({ where: { id } });
  }
}

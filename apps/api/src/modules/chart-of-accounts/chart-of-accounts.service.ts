import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';

@Injectable()
export class ChartOfAccountsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter?: {
    type?: string;
    status?: string;
    q?: string;
  }) {
    return this.prisma.chartOfAccount.findMany({
      where: {
        deletedAt: null,
        ...(filter?.type && { type: filter.type }),
        ...(filter?.status && { status: filter.status }),
        ...(filter?.q && {
          OR: [
            { code: { contains: filter.q, mode: 'insensitive' } },
            { name: { contains: filter.q, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: [{ code: 'asc' }],
    });
  }

  /** T15: Return code+name pairs for a list of account codes (for UI dropdowns). */
  async findByCodes(codes: string[]): Promise<{ code: string; name: string }[]> {
    if (!codes.length) return [];
    return this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.chartOfAccount.findUnique({ where: { id, deletedAt: null } });
    if (!account) throw new NotFoundException('ไม่พบบัญชี');
    return account;
  }

  async create(dto: CreateChartOfAccountDto) {
    // Uniqueness check on code (single chart in A.4)
    const exists = await this.prisma.chartOfAccount.findUnique({
      where: { code: dto.code },
    });
    if (exists) throw new ConflictException(`รหัสบัญชี ${dto.code} มีอยู่แล้ว`);

    return this.prisma.chartOfAccount.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        normalBalance: dto.normalBalance,
        category: dto.category ?? null,
        vatApplicable: dto.vatApplicable ?? false,
        notes: dto.notes ?? null,
        status: dto.status ?? 'ใช้งาน',
      },
    });
  }

  async update(id: string, dto: UpdateChartOfAccountDto) {
    await this.findOne(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.normalBalance !== undefined) data.normalBalance = dto.normalBalance;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.vatApplicable !== undefined) data.vatApplicable = dto.vatApplicable;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.chartOfAccount.update({ where: { id }, data });
  }

  async remove(id: string) {
    const account = await this.findOne(id);

    // Block delete if any journal lines reference this code
    const used = await this.prisma.journalLine.count({ where: { accountCode: account.code } });
    if (used > 0) {
      // Soft-disable instead of hard-delete to preserve history
      return this.prisma.chartOfAccount.update({ where: { id }, data: { status: 'ไม่ใช้งาน' } });
    }

    return this.prisma.chartOfAccount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

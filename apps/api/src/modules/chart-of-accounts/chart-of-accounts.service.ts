import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { CoaAccountRow, CoaGroupedResponse } from './dto/coa-grouped.dto';
import { AccountRoleService } from '../journal/account-role.service';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    private prisma: PrismaService,
    private roles: AccountRoleService,
  ) {}

  /**
   * D1.1.6.2 — Resolve the active CoA codes for the small set of "adjustment"
   * roles consumed by the AdjustmentSection UI. Decouples the frontend hint
   * from hardcoded literals so an owner-driven `account_role_map` change
   * propagates to the picker without a deploy. Codes resolved at request
   * time so a fresh admin-edit (followed by `roles.invalidate()`) takes
   * effect on the next call.
   */
  async getAdjustmentRoleCodes(): Promise<{ underpay: string; overpay: string }> {
    return {
      underpay: this.roles.code('adj_underpay'),
      overpay: this.roles.code('adj_overpay'),
    };
  }

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

  async findGrouped(query: { type?: string; codePrefix?: string; category?: string }): Promise<CoaGroupedResponse> {
    const where: Prisma.ChartOfAccountWhereInput = { deletedAt: null, status: 'ใช้งาน' };
    if (query.type) where.type = query.type;
    if (query.codePrefix) where.code = { startsWith: query.codePrefix };
    if (query.category) where.category = query.category;

    const rows = await this.prisma.chartOfAccount.findMany({
      where,
      orderBy: { code: 'asc' },
      select: {
        code: true,
        name: true,
        normalBalance: true,
        category: true,
        vatApplicable: true,
        notes: true,
      },
    });

    const map = new Map<string, CoaAccountRow[]>();
    for (const r of rows) {
      const cat = r.category ?? 'อื่นๆ';
      const arr = map.get(cat) ?? [];
      arr.push({
        code: r.code,
        name: r.name,
        normalBalance: r.normalBalance,
        vatApplicable: r.vatApplicable,
        notes: r.notes,
      });
      map.set(cat, arr);
    }
    return { groups: Array.from(map, ([category, accounts]) => ({ category, accounts })) };
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

import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { CoaAccountRow, CoaGroupedResponse } from './dto/coa-grouped.dto';
import { UpdatePeakMappingDto } from './dto/peak-mapping.dto';

/**
 * P3-SP3: PEAK mapping row returned to the settings UI. peakCode is null when
 * the owner hasn't mapped this account yet — the UI shows an empty input cell.
 */
export interface PeakMappingRow {
  id: string;
  code: string;
  name: string;
  type: string;
  peakCode: string | null;
}

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

  // ============================================================
  // P3-SP3: PEAK code mapping
  // ============================================================

  /** Return all active accounts with current PEAK code mapping (for the settings table). */
  async getPeakMapping(): Promise<PeakMappingRow[]> {
    const rows = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null, status: 'ใช้งาน' },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, type: true, peakCode: true },
    });
    return rows;
  }

  /**
   * Bulk-update peakCode on a list of accounts. Writes one AuditLog row
   * summarising what changed (entity = `chart_of_account`, entityId =
   * comma-joined codes). Empty-string peakCode values are rejected — DTO must
   * pass null or a non-empty trimmed value.
   */
  async updatePeakMapping(
    dto: UpdatePeakMappingDto,
    userId: string,
  ): Promise<{ updated: number }> {
    if (!dto.mappings.length) return { updated: 0 };

    // Validate: peakCode must be either null/undefined or a trimmed non-empty string.
    // (The regex in the DTO allows ""; we reject explicitly here so the column
    // never stores '' — only null or a real code.)
    const normalised = dto.mappings.map((m) => {
      const raw = m.peakCode;
      if (raw === undefined || raw === null) {
        return { id: m.id, peakCode: null as string | null };
      }
      const trimmed = String(raw).trim();
      if (trimmed.length === 0) {
        return { id: m.id, peakCode: null };
      }
      return { id: m.id, peakCode: trimmed };
    });

    // Pre-load existing rows in a single query so we can (a) reject unknown IDs
    // and (b) capture before/after values for the audit log.
    const ids = normalised.map((m) => m.id);
    const existing = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, code: true, peakCode: true },
    });
    const existingMap = new Map(existing.map((e) => [e.id, e]));
    const missing = normalised.filter((m) => !existingMap.has(m.id));
    if (missing.length) {
      throw new BadRequestException(
        `ไม่พบบัญชี: ${missing.slice(0, 5).map((m) => m.id).join(', ')}${missing.length > 5 ? '...' : ''}`,
      );
    }

    // Apply updates inside a transaction so partial failure rolls back the
    // whole batch (matches the all-or-nothing UX expected by a Save button).
    const changes: { code: string; before: string | null; after: string | null }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const m of normalised) {
        const prev = existingMap.get(m.id)!;
        if (prev.peakCode !== m.peakCode) {
          await tx.chartOfAccount.update({
            where: { id: m.id },
            data: { peakCode: m.peakCode },
          });
          changes.push({ code: prev.code, before: prev.peakCode, after: m.peakCode });
        }
      }

      if (changes.length > 0) {
        await tx.auditLog.create({
          data: {
            userId,
            action: 'PEAK_MAPPING_UPDATED',
            entity: 'chart_of_account',
            entityId: changes.map((c) => c.code).join(','),
            newValue: {
              changes: changes.map((c) => ({
                code: c.code,
                before: c.before,
                after: c.after,
              })),
              count: changes.length,
            } as unknown as Prisma.JsonObject,
          },
        });
      }
    });

    return { updated: changes.length };
  }

  /**
   * Render the current PEAK mapping as a CSV string (UTF-8 BOM, 3 columns:
   * code, name, peakCode). For Excel-friendly Thai display + later re-import.
   */
  async exportPeakMappingCsv(): Promise<string> {
    const rows = await this.getPeakMapping();
    const escape = (v: string | null) => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const header = ['code', 'name', 'peakCode'].join(',');
    const body = rows.map((r) => [escape(r.code), escape(r.name), escape(r.peakCode)].join(','));
    // UTF-8 BOM so Excel renders Thai correctly without prompting for encoding.
    return '﻿' + [header, ...body].join('\n');
  }
}

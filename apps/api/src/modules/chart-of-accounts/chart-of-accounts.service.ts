import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { CoaAccountRow, CoaGroupedResponse } from './dto/coa-grouped.dto';
import { PEAK_SUB_CODE_SOURCES, UpdatePeakMappingDto } from './dto/peak-mapping.dto';

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
  /** FINANCE mapping v5: fixed PEAK sub-account code (null unless source = 'fixed'). */
  peakSubCode: string | null;
  /** none | fixed | contact | bank | cashbox — see PEAK_SUB_CODE_SOURCES. */
  peakSubCodeSource: string;
}

/** Resolved target state of one mapping row after merging the request over the DB row. */
interface PeakMappingState {
  peakCode: string | null;
  peakSubCode: string | null;
  peakSubCodeSource: string;
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
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        peakCode: true,
        peakSubCode: true,
        peakSubCodeSource: true,
      },
    });
    return rows;
  }

  /**
   * Bulk-update peakCode (+ peakSubCode / peakSubCodeSource) on a list of
   * accounts. Writes one AuditLog row summarising what changed (entity =
   * `chart_of_account`, entityId = comma-joined codes). Empty-string codes are
   * normalised to null. Sub-code fields that are OMITTED keep their stored
   * value; a source other than 'fixed' always clears the sub-code, and
   * 'fixed' without a sub-code is rejected (ฝ่ายบัญชี mapping v5 19/10/2569).
   */
  async updatePeakMapping(
    dto: UpdatePeakMappingDto,
    userId: string,
  ): Promise<{ updated: number }> {
    if (!dto.mappings.length) return { updated: 0 };

    // Validate: peakCode must be either null/undefined or a trimmed non-empty string.
    // (The regex in the DTO allows ""; we reject explicitly here so the column
    // never stores '' — only null or a real code.)
    const trimOrNull = (raw: string | null | undefined): string | null => {
      if (raw === undefined || raw === null) return null;
      const trimmed = String(raw).trim();
      return trimmed.length === 0 ? null : trimmed;
    };
    const normalised = dto.mappings.map((m) => ({
      id: m.id,
      peakCode: trimOrNull(m.peakCode),
      // undefined = "not sent" → keep the stored value (see DTO docblock)
      peakSubCode: m.peakSubCode === undefined ? undefined : trimOrNull(m.peakSubCode),
      peakSubCodeSource:
        m.peakSubCodeSource === undefined ? undefined : String(m.peakSubCodeSource).trim(),
    }));

    // Pre-load existing rows in a single query so we can (a) reject unknown IDs
    // and (b) capture before/after values for the audit log.
    const ids = normalised.map((m) => m.id);
    const existing = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, code: true, peakCode: true, peakSubCode: true, peakSubCodeSource: true },
    });
    const existingMap = new Map(existing.map((e) => [e.id, e]));
    const missing = normalised.filter((m) => !existingMap.has(m.id));
    if (missing.length) {
      throw new BadRequestException(
        `ไม่พบบัญชี: ${missing.slice(0, 5).map((m) => m.id).join(', ')}${missing.length > 5 ? '...' : ''}`,
      );
    }

    // Resolve the target state of every row BEFORE opening the transaction so a
    // validation failure never leaves a half-applied batch.
    const targets = normalised.map((m) => {
      const prev = existingMap.get(m.id)!;
      // Rows written before mapping v5 (and older test fixtures) may lack the
      // column entirely — treat "missing" exactly like the DB default 'none'.
      const prevSource = prev.peakSubCodeSource ?? 'none';
      const source = m.peakSubCodeSource ?? prevSource;
      if (!(PEAK_SUB_CODE_SOURCES as readonly string[]).includes(source)) {
        throw new BadRequestException(`แหล่งรหัสย่อยไม่ถูกต้อง: ${source} (บัญชี ${prev.code})`);
      }
      const requestedSub = m.peakSubCode === undefined ? (prev.peakSubCode ?? null) : m.peakSubCode;
      // Only a fixed source carries a value; dynamic sources are resolved per line at export.
      const peakSubCode = source === 'fixed' ? requestedSub : null;
      if (source === 'fixed' && !peakSubCode) {
        throw new BadRequestException(
          `บัญชี ${prev.code}: แหล่งรหัสย่อย "คงที่" (fixed) ต้องระบุรหัสย่อย PEAK`,
        );
      }
      const next: PeakMappingState = { peakCode: m.peakCode, peakSubCode, peakSubCodeSource: source };
      return { id: m.id, prev, next };
    });

    // Apply updates inside a transaction so partial failure rolls back the
    // whole batch (matches the all-or-nothing UX expected by a Save button).
    const changes: {
      code: string;
      before: string | null;
      after: string | null;
      peakSubCodeBefore: string | null;
      peakSubCodeAfter: string | null;
      sourceBefore: string;
      sourceAfter: string;
    }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const { id, prev, next } of targets) {
        const data: Partial<PeakMappingState> = {};
        if (prev.peakCode !== next.peakCode) data.peakCode = next.peakCode;
        if ((prev.peakSubCode ?? null) !== next.peakSubCode) data.peakSubCode = next.peakSubCode;
        if ((prev.peakSubCodeSource ?? 'none') !== next.peakSubCodeSource) {
          data.peakSubCodeSource = next.peakSubCodeSource;
        }
        if (Object.keys(data).length === 0) continue;
        await tx.chartOfAccount.update({ where: { id }, data });
        changes.push({
          code: prev.code,
          before: prev.peakCode,
          after: next.peakCode,
          peakSubCodeBefore: prev.peakSubCode ?? null,
          peakSubCodeAfter: next.peakSubCode,
          sourceBefore: prev.peakSubCodeSource ?? 'none',
          sourceAfter: next.peakSubCodeSource,
        });
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
                peakSubCodeBefore: c.peakSubCodeBefore,
                peakSubCodeAfter: c.peakSubCodeAfter,
                sourceBefore: c.sourceBefore,
                sourceAfter: c.sourceAfter,
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
   * Render the current PEAK mapping as a CSV string (UTF-8 BOM, 5 columns:
   * code, name, peakCode, peakSubCode, peakSubCodeSource). For Excel-friendly
   * Thai display + later re-import (the first three columns are unchanged
   * from the P3-SP3 format, so older import sheets still line up).
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
    const header = ['code', 'name', 'peakCode', 'peakSubCode', 'peakSubCodeSource'].join(',');
    const body = rows.map((r) =>
      [
        escape(r.code),
        escape(r.name),
        escape(r.peakCode),
        escape(r.peakSubCode),
        escape(r.peakSubCodeSource),
      ].join(','),
    );
    // UTF-8 BOM so Excel renders Thai correctly without prompting for encoding.
    return '﻿' + [header, ...body].join('\n');
  }
}

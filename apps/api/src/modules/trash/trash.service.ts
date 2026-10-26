import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  DELETE_AUDIT_ACTIONS,
  TRASH_REGISTRY,
  trashEntry,
  type TrashAnyRow,
  type TrashEntry,
  type TrashType,
} from './trash-registry';

/**
 * ถังขยะรวม (ก้อน 8 · A10) — อ่านของที่ถูก soft-delete ตาม allow-list (`trash-registry.ts`) รวมหลายโมเดล
 * + หาว่าใครลบจาก AuditLog (`(entity, entityId)` ตาม index) · การกู้อยู่ใน Task 3
 */

export interface TrashListQuery {
  type?: string;
  q?: string;
  /** 0 = ทั้งหมด */
  days: number;
  page: number;
  pageSize: number;
}

export interface TrashDeletedBy {
  id: string;
  name: string;
  /** ผู้ใช้ระบบ (cron/งานอัตโนมัติ) — ของที่ระบบลบเองกู้ไม่ได้ (สเปก §13.3) */
  system: boolean;
}

export interface TrashRow {
  type: TrashType;
  typeLabel: string;
  group: string;
  id: string;
  title: string;
  subtitle: string;
  deletedAt: Date;
  deletedBy: TrashDeletedBy | null;
  restorable: boolean;
  reason?: string;
  actionLabel?: string;
  link?: string;
}

export interface TrashListResult {
  data: TrashRow[];
  total: number;
  page: number;
  pageSize: number;
  /** ดูรวมทุกประเภท = ดึงล่าสุด ≤ PER_TYPE_CAP ต่อประเภทแล้วรวม — ไม่ใช่ทั้งหมด */
  capped: boolean;
}

export const TRASH_PER_TYPE_CAP = 50;
export const TRASH_AUDIT_MATCH_WINDOW_MS = 10 * 60_000;
export const SYSTEM_DELETED_REASON = 'ระบบลบเอง (เช่น งวดบิลประจำถูกแทน) — กู้ไม่ได้';

interface AuditHit {
  entityId: string;
  createdAt: Date;
  user: { id: string; name: string; isSystemUser: boolean } | null;
}

@Injectable()
export class TrashService {
  protected readonly logger = new Logger(TrashService.name);

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
    protected readonly moduleRef: ModuleRef,
  ) {}

  // ─── อ่าน ─────────────────────────────────────────────────────────────────────────────

  async listTypes(days: number, now: Date = new Date()): Promise<Array<{ type: TrashType; label: string; group: string; count: number; restorable: boolean }>> {
    return Promise.all(
      TRASH_REGISTRY.map(async (entry) => ({
        type: entry.type,
        label: entry.label,
        group: entry.group,
        count: await this.delegate(entry).count({ where: this.deletedWhere(entry, days, now) }),
        restorable: entry.restorable === true,
      })),
    );
  }

  async list(query: TrashListQuery, now: Date = new Date()): Promise<TrashListResult> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.max(1, query.pageSize || TRASH_PER_TYPE_CAP);
    const entries = this.entriesFor(query.type);
    const single = entries.length === 1 && !!query.type;

    const fetched = await Promise.all(
      entries.map(async (entry) => {
        const where = this.searchWhere(entry, query.q, this.deletedWhere(entry, query.days, now));
        const delegate = this.delegate(entry);
        const [rows, count] = await Promise.all([
          delegate.findMany({
            where,
            select: entry.select,
            orderBy: { deletedAt: 'desc' },
            skip: single ? (page - 1) * pageSize : 0,
            take: single ? pageSize : TRASH_PER_TYPE_CAP,
          }),
          delegate.count({ where }),
        ]);
        return { entry, rows: rows as TrashAnyRow[], count: count as number };
      }),
    );

    const merged = fetched
      .flatMap(({ entry, rows }) => rows.map((row) => ({ entry, row })))
      .sort((a, b) => new Date(b.row.deletedAt).getTime() - new Date(a.row.deletedAt).getTime());
    const pageItems = single ? merged : merged.slice((page - 1) * pageSize, page * pageSize);
    const deletedBy = await this.resolveDeletedBy(pageItems);

    return {
      data: pageItems.map(({ entry, row }) => this.toTrashRow(entry, row, deletedBy.get(`${entry.type}:${row.id}`) ?? null)),
      total: fetched.reduce((sum, f) => sum + f.count, 0),
      page,
      pageSize,
      capped: !single,
    };
  }

  /** ใครลบ — แถว AuditLog การลบที่ใกล้ `deletedAt` ที่สุดภายใน ±10 นาที · ค้นด้วย (entity, entityId) ตาม index */
  async resolveDeletedBy(items: Array<{ entry: TrashEntry; row: TrashAnyRow }>): Promise<Map<string, TrashDeletedBy | null>> {
    const result = new Map<string, TrashDeletedBy | null>();
    if (items.length === 0) return result;
    const auditIdOf = (entry: TrashEntry, row: TrashAnyRow) => (entry.auditEntityId ? entry.auditEntityId(row) : row.id);
    const byEntry = new Map<TrashEntry, string[]>();
    for (const { entry, row } of items) {
      const ids = byEntry.get(entry) ?? [];
      ids.push(auditIdOf(entry, row));
      byEntry.set(entry, ids);
    }
    const hits = (await this.prisma.auditLog.findMany({
      where: {
        action: { in: DELETE_AUDIT_ACTIONS },
        OR: [...byEntry.entries()].map(([entry, ids]) => ({ entity: { in: entry.auditEntities }, entityId: { in: ids } })),
      },
      select: { entityId: true, createdAt: true, user: { select: { id: true, name: true, isSystemUser: true } } },
    })) as AuditHit[];
    for (const { entry, row } of items) {
      const auditId = auditIdOf(entry, row);
      const deletedAt = new Date(row.deletedAt).getTime();
      let best: AuditHit | null = null;
      for (const hit of hits) {
        if (hit.entityId !== auditId) continue;
        const distance = Math.abs(new Date(hit.createdAt).getTime() - deletedAt);
        if (distance > TRASH_AUDIT_MATCH_WINDOW_MS) continue;
        if (!best || distance < Math.abs(new Date(best.createdAt).getTime() - deletedAt)) best = hit;
      }
      result.set(`${entry.type}:${row.id}`, best?.user ? { id: best.user.id, name: best.user.name, system: !!best.user.isSystemUser } : null);
    }
    return result;
  }

  // ─── ตัวช่วย ──────────────────────────────────────────────────────────────────────────

  protected entriesFor(type?: string): TrashEntry[] {
    if (!type) return [...TRASH_REGISTRY];
    const entry = trashEntry(type);
    if (!entry) throw new BadRequestException(`ไม่รู้จักประเภท "${type}"`);
    return [entry];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected delegate(entry: TrashEntry): any {
    return (this.prisma as unknown as Record<string, unknown>)[entry.model];
  }

  protected deletedWhere(entry: TrashEntry, days: number, now: Date): Record<string, unknown> {
    const deletedAt = days > 0 ? { gte: new Date(now.getTime() - days * 24 * 3600_000) } : { not: null };
    return { deletedAt, ...(entry.extraWhere ?? {}) };
  }

  protected searchWhere(entry: TrashEntry, q: string | undefined, base: Record<string, unknown>): Record<string, unknown> {
    const term = q?.trim();
    if (!term || entry.searchFields.length === 0) return base;
    return { ...base, OR: entry.searchFields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })) };
  }

  protected toTrashRow(entry: TrashEntry, row: TrashAnyRow, deletedBy: TrashDeletedBy | null): TrashRow {
    const view = entry.toRow(row);
    const base = { type: entry.type, typeLabel: entry.label, group: entry.group, id: row.id as string, title: view.title, subtitle: view.subtitle, deletedAt: row.deletedAt as Date, deletedBy, link: view.link };
    if (deletedBy?.system) return { ...base, restorable: false, reason: SYSTEM_DELETED_REASON };
    if (entry.restorable === true) return { ...base, restorable: true };
    return { ...base, restorable: false, reason: entry.restorable.reason, actionLabel: entry.restorable.actionLabel, link: entry.restorable.linkFor?.(row) ?? view.link };
  }
}

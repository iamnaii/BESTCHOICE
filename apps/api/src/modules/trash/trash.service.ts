import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { JourneyStateService } from '../customer-journey/journey-state.service';
import { CustomerTagsService } from '../customer-tags/customer-tags.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  DELETE_AUDIT_ACTIONS,
  RESTORE_AUDIT_ACTION,
  TRASH_REGISTRY,
  trashEntry,
  type TrashAfterRestoreServices,
  type TrashAnyRow,
  type TrashEntry,
  type TrashType,
} from './trash-registry';

/**
 * ถังขยะรวม (ก้อน 8 · A10) — อ่านของที่ถูก soft-delete ตาม allow-list (`trash-registry.ts`) รวมหลายโมเดล
 * + หาว่าใครลบจาก AuditLog (`(entity, entityId)` ตาม index) · กู้คืน = ตรวจ → `deletedAt: null` ใน tx → งานนอก tx → audit หลัง commit
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
export const NOT_IN_TRASH_MESSAGE = 'ไม่พบรายการนี้ในถังขยะ (อาจถูกกู้คืนไปแล้ว)';
export const TRASH_BULK_MAX = 50;

export interface TrashRestoreResult {
  ok: true;
  warnings: string[];
  link?: string;
}

export interface TrashBulkItem {
  type: string;
  id: string;
}

export interface TrashBulkResult {
  results: Array<{ type: string; id: string; ok: boolean; error?: string; warnings?: string[]; link?: string }>;
}

interface AuditHit {
  entityId: string;
  createdAt: Date;
  newValue: unknown;
  user: { id: string; name: string; isSystemUser: boolean } | null;
}

/** ผลหา "ใครลบ" ต่อแถว + เหตุผลที่กู้ไม่ได้จากแถว audit (ระบบลบเอง / ร่างบิลประจำถูกแทน) */
export interface TrashDeletionInfo {
  deletedBy: TrashDeletedBy | null;
  block: string | null;
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

  async listTypes(days: number, now: Date = new Date()): Promise<Array<{ type: TrashType; label: string; group: string; count: number; restorable: boolean; hint?: string }>> {
    return Promise.all(
      TRASH_REGISTRY.map(async (entry) => ({
        type: entry.type,
        label: entry.label,
        group: entry.group,
        count: await this.delegate(entry).count({ where: this.deletedWhere(entry, days, now) }),
        restorable: entry.restorable === true,
        hint: entry.restorable !== true && entry.restorable.actionLabel ? `กู้ผ่าน${entry.restorable.actionLabel.replace(/^ขอ/, 'คำขอ')}` : undefined,
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
        if (!where) return { entry, rows: [] as TrashAnyRow[], count: 0 }; // ค้นหาในประเภทที่ไม่มีฟิลด์ค้น = ไม่มีผล (ไม่ใช่ทุกแถว)
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
    const deletion = await this.resolveDeletedBy(pageItems);

    return {
      data: pageItems.map(({ entry, row }) => this.toTrashRow(entry, row, deletion.get(`${entry.type}:${row.id}`) ?? { deletedBy: null, block: null })),
      // ดูรวม: ข้อมูลถูกตัดที่ PER_TYPE_CAP ต่อประเภท ⇒ total ต้องนับเท่าที่แสดงได้ ไม่งั้นหน้าท้าย ๆ ว่าง
      total: fetched.reduce((sum, f) => sum + (single ? f.count : Math.min(f.count, TRASH_PER_TYPE_CAP)), 0),
      page,
      pageSize,
      capped: !single,
    };
  }

  /** ใครลบ — แถว AuditLog การลบที่ใกล้ `deletedAt` ที่สุดภายใน ±10 นาที · ค้นด้วย (entity, entityId) ตาม index · + เหตุผลบล็อกจาก audit */
  async resolveDeletedBy(items: Array<{ entry: TrashEntry; row: TrashAnyRow }>): Promise<Map<string, TrashDeletionInfo>> {
    const result = new Map<string, TrashDeletionInfo>();
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
      select: { entityId: true, createdAt: true, newValue: true, user: { select: { id: true, name: true, isSystemUser: true } } },
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
      result.set(`${entry.type}:${row.id}`, {
        deletedBy: best?.user ? { id: best.user.id, name: best.user.name, system: !!best.user.isSystemUser } : null,
        block: best ? (entry.auditBlocks?.({ newValue: best.newValue }) ?? null) : null,
      });
    }
    return result;
  }

  // ─── กู้คืน ───────────────────────────────────────────────────────────────────────────

  async restore(type: string, id: string, actor: { id: string }): Promise<TrashRestoreResult> {
    const entry = trashEntry(type);
    if (!entry) throw new BadRequestException(`ไม่รู้จักประเภท "${type}"`);
    const delegate = this.delegate(entry);

    if (entry.restorable !== true) {
      const row = (await delegate.findUnique({ where: { id }, select: entry.select })) as TrashAnyRow | null;
      throw new BadRequestException({
        message: entry.restorable.reason,
        actionLabel: entry.restorable.actionLabel,
        link: row ? entry.restorable.linkFor?.(row) : undefined,
      });
    }

    // ตรวจนอก tx ก่อน: ยังอยู่ในถังจริง · ไม่ใช่ของที่ระบบลบเอง (สเปก §13.3)
    const peek = (await delegate.findUnique({ where: { id }, select: entry.select })) as TrashAnyRow | null;
    if (!peek || !peek.deletedAt || !this.matchesExtraWhere(entry, peek)) throw new NotFoundException(NOT_IN_TRASH_MESSAGE);
    const deletion = (await this.resolveDeletedBy([{ entry, row: peek }])).get(`${entry.type}:${id}`);
    if (deletion?.block) throw new BadRequestException(deletion.block);
    if (deletion?.deletedBy?.system) throw new BadRequestException(SYSTEM_DELETED_REASON);

    const row: TrashAnyRow = peek;
    const data = { deletedAt: null, ...(entry.restoreData?.(row) ?? {}) };
    try {
      await this.prisma.$transaction(async (tx) => {
        const ctx = { tx, actorId: actor.id };
        // check ก่อนทุกอย่าง — ล็อกเบอร์ลูกค้าต้องเป็นคำสั่งแรกของ tx (database.md)
        await entry.check?.(ctx, row);
        // compare-and-set: กู้พร้อมกันสองครั้งได้แถวเดียว · extraWhere ตัดสินที่ DB
        const txDelegate = (tx as unknown as Record<string, { updateMany: (args: unknown) => Promise<{ count: number }> }>)[entry.model];
        const { count } = await txDelegate.updateMany({ where: { id, deletedAt: { not: null }, ...(entry.extraWhere ?? {}) }, data });
        if (count !== 1) throw new NotFoundException(NOT_IN_TRASH_MESSAGE);
        await entry.restoreExtra?.(ctx, row);
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') throw new ConflictException('กู้ไม่ได้: ข้อมูลซ้ำกับรายการที่ยังใช้งานอยู่');
      throw err;
    }

    const warnings = [...(entry.warnings?.(row) ?? [])];
    if (entry.afterRestore) {
      try {
        warnings.push(...(await entry.afterRestore(row, this.afterRestoreServices())));
      } catch (err) {
        Sentry.captureException(err, { tags: { subsystem: 'trash', type: entry.type }, extra: { id } });
        this.logger.error(`[trash] afterRestore ${entry.type}/${id} ล้ม: ${err instanceof Error ? err.message : String(err)}`);
        warnings.push('กู้แล้วแต่คำนวณข้อมูลประกอบไม่สำเร็จ — ข้อมูลหลักถูกต้อง');
      }
    }

    // audit หลัง commit → อยู่ในสาย Merkle (database.md) — ห้ามเรียกใน tx
    await this.audit.log({
      action: RESTORE_AUDIT_ACTION,
      entity: entry.type,
      entityId: id,
      userId: actor.id,
      oldValue: { deletedAt: new Date(row.deletedAt).toISOString() },
      newValue: { changes: Object.keys(data), warnings },
    });

    return { ok: true, warnings, link: entry.toRow(row).link };
  }

  /** กู้หลายรายการทีละรายการ — รายการที่ล้มไม่หยุดรายการอื่น (สเปก §6) */
  async restoreMany(items: TrashBulkItem[], actor: { id: string }): Promise<TrashBulkResult> {
    if (items.length > TRASH_BULK_MAX) throw new BadRequestException(`กู้ได้ครั้งละไม่เกิน ${TRASH_BULK_MAX} รายการ`);
    const results: TrashBulkResult['results'] = [];
    for (const item of items) {
      try {
        const r = await this.restore(item.type, item.id, actor);
        results.push({ type: item.type, id: item.id, ok: true, warnings: r.warnings, link: r.link });
      } catch (err) {
        results.push({ type: item.type, id: item.id, ok: false, error: errorText(err) });
      }
    }
    return { results };
  }

  protected afterRestoreServices(): TrashAfterRestoreServices {
    const get = <T>(token: new (...args: never[]) => T): T | undefined => {
      try {
        return this.moduleRef.get(token, { strict: false });
      } catch {
        return undefined;
      }
    };
    return { prisma: this.prisma, journeyState: get(JourneyStateService), tags: get(CustomerTagsService) };
  }

  protected matchesExtraWhere(entry: TrashEntry, row: TrashAnyRow): boolean {
    return Object.entries(entry.extraWhere ?? {}).every(([key, value]) => (value === null ? row[key] == null : row[key] === value));
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

  /** null = ประเภทนี้ค้นไม่ได้ (ไม่มีฟิลด์ข้อความ) จึงไม่มีผลเมื่อมีคำค้น */
  protected searchWhere(entry: TrashEntry, q: string | undefined, base: Record<string, unknown>): Record<string, unknown> | null {
    const term = q?.trim();
    if (!term) return base;
    if (entry.searchFields.length === 0) return null;
    return { ...base, OR: entry.searchFields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })) };
  }

  protected toTrashRow(entry: TrashEntry, row: TrashAnyRow, deletion: TrashDeletionInfo): TrashRow {
    const view = entry.toRow(row);
    const { deletedBy, block } = deletion;
    const base = { type: entry.type, typeLabel: entry.label, group: entry.group, id: row.id as string, title: view.title, subtitle: view.subtitle, deletedAt: row.deletedAt as Date, deletedBy, link: view.link };
    if (block) return { ...base, restorable: false, reason: block };
    if (deletedBy?.system) return { ...base, restorable: false, reason: SYSTEM_DELETED_REASON };
    if (entry.restorable === true) return { ...base, restorable: true };
    return { ...base, restorable: false, reason: entry.restorable.reason, actionLabel: entry.restorable.actionLabel, link: entry.restorable.linkFor?.(row) ?? view.link };
  }
}

function errorText(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse();
    if (typeof res === 'string') return res;
    const message = (res as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' · ');
  }
  return err instanceof Error ? err.message : String(err);
}


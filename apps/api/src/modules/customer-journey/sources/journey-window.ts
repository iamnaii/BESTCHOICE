import { BadRequestException } from '@nestjs/common';
import { JOURNEY_HIDDEN_GROUPS, type JourneyEvent, type JourneyEventGroup } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';

export interface JourneyActor { id: string; role: string }

/** before = cursor ที่ถอดแล้ว (ตัว cursor เองไม่อยู่ในผล) */
export interface JourneyWindow { before?: { ts: string; id: string }; from?: Date; to?: Date; limit: number }

/** ทุกไฟล์ใน sources/ คืนรายการเรียงใหม่→เก่า ไม่เกิน limit+1 */
export type JourneySource = (prisma: PrismaService, customerIds: string[], window: JourneyWindow, actor: JourneyActor) => Promise<JourneyEvent[]>;

type EventActor = NonNullable<JourneyEvent['actor']>;
type EventKey = Pick<JourneyEvent, 'timestamp' | 'id'>;

/**
 * กฎกลุ่มที่บทบาทไม่เห็นมีที่เดียว = JOURNEY_HIDDEN_GROUPS ของ shared (ห้ามประกาศชุดบทบาทซ้ำใน API)
 * ทั้ง resolveJourneyGroups และทุกแหล่ง (แชท · ลิงก์แชท · ยอดชำระ · ติดตามหนี้) ถามผ่านฟังก์ชันนี้ — เจ้าของเคาะเปลี่ยนที่ shared แล้วมีผลทั้งเส้น
 */
export function roleSeesGroup(role: string, group: JourneyEventGroup): boolean {
  const hidden = Object.prototype.hasOwnProperty.call(JOURNEY_HIDDEN_GROUPS, role) ? JOURNEY_HIDDEN_GROUPS[role] : [];
  return !hidden.includes(group);
}

/** DB เรียงด้วยเวลาอย่างเดียว เวลาเท่ากันตัดสินด้วย id ใน JS (ไม่พึ่ง collation) — ผิดได้เมื่อมีแถวเวลาเดียวกันเกิน 200 แถวที่รอยตัดเท่านั้น */
export const SOURCE_SCAN_PAD = 200;
export const scanTake = (window: JourneyWindow): number => window.limit + 1 + SOURCE_SCAN_PAD;

export interface TimeRange { lte?: Date; gte?: Date }

/** ขอบเวลาฝั่ง DB (รวมเวลาเท่ากับ cursor — finalizeSource ตัดเอง) */
export function dbTimeRange(window: JourneyWindow): TimeRange | undefined {
  const before = window.before ? new Date(window.before.ts) : undefined;
  const upper = before && window.to ? (before < window.to ? before : window.to) : before ?? window.to;
  const range: TimeRange = {};
  if (upper) range.lte = upper;
  if (window.from) range.gte = window.from;
  return range.lte || range.gte ? range : undefined;
}

export function compareEventsDesc(a: EventKey, b: EventKey): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

export const encodeJourneyCursor = (event: EventKey): string => Buffer.from(`${event.timestamp}|${event.id}`, 'utf8').toString('base64');

export function decodeJourneyCursor(cursor: string): { ts: string; id: string } {
  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const bar = raw.indexOf('|');
  const ts = bar > 0 ? raw.slice(0, bar) : '';
  const id = bar > 0 ? raw.slice(bar + 1) : '';
  const validTs = !Number.isNaN(Date.parse(ts)) && new Date(ts).toISOString() === ts;
  if (!id || !validTs) throw new BadRequestException('cursor ไม่ถูกต้อง');
  return { ts, id };
}

export function finalizeSource(events: JourneyEvent[], window: JourneyWindow): JourneyEvent[] {
  const cursor = window.before ? { timestamp: window.before.ts, id: window.before.id } : null;
  const from = window.from?.toISOString();
  const to = window.to?.toISOString();
  return events
    .filter((e) => (!cursor || compareEventsDesc(e, cursor) > 0) && (!from || e.timestamp >= from) && (!to || e.timestamp <= to))
    .sort(compareEventsDesc)
    .slice(0, window.limit + 1);
}

/**
 * แหล่งที่คืนครบ limit+1 อาจยังมีรายการเก่ากว่า ⇒ หน้าไม่เลย "ขอบ" ที่ใหม่สุดของแหล่งเหล่านั้น
 * กรองกลุ่มหลังดึง (entries คืนหลายกลุ่ม) แต่ขอบคิดจากรายการก่อนกรอง หน้าจึงไม่ข้าม
 */
export function mergeJourneyPage(perSource: JourneyEvent[][], limit: number, groups: ReadonlySet<JourneyEventGroup>): { events: JourneyEvent[]; nextCursor: string | null } {
  let edge: JourneyEvent | null = null;
  for (const list of perSource) {
    if (list.length <= limit) continue;
    const last = list[list.length - 1];
    if (!edge || compareEventsDesc(last, edge) < 0) edge = last;
  }
  const boundary = edge;
  const visible = perSource.flat().filter((e) => groups.has(e.group)).sort(compareEventsDesc)
    .filter((e) => !boundary || compareEventsDesc(e, boundary) <= 0);
  if (visible.length > limit) {
    const events = visible.slice(0, limit);
    return { events, nextCursor: encodeJourneyCursor(events[events.length - 1]) };
  }
  return { events: visible, nextCursor: boundary ? encodeJourneyCursor(boundary) : null };
}

export async function whenAny<T>(keys: readonly unknown[], run: () => Promise<T[]>): Promise<T[]> {
  return keys.length ? run() : [];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function pickMetadata(source: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  const record = asRecord(source);
  const picked = Object.fromEntries(keys.filter((k) => record[k] !== undefined && record[k] !== null).map((k) => [k, record[k]]));
  return Object.keys(picked).length ? picked : undefined;
}

export function staffActor(user: { id: string; name: string } | null | undefined): EventActor {
  return user ? { type: 'STAFF', id: user.id, name: user.name } : { type: 'STAFF' };
}

const ACTOR_TYPES: readonly string[] = ['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM'];
export const asActorType = (value: string): EventActor['type'] => (ACTOR_TYPES.includes(value) ? (value as EventActor['type']) : 'SYSTEM');

export const bahtText = (value: { toString(): string }): string => Number(value.toString()).toLocaleString('th-TH', { maximumFractionDigits: 2 });

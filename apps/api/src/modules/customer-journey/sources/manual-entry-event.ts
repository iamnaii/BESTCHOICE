import {
  JOURNEY_ENTRY_KINDS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  type JourneyEvent,
  type JourneyManualEntryKind,
} from '@installment/shared';
import type { Prisma } from '@prisma/client';
import { asActorType, roleSeesGroup, type JourneyActor } from './journey-window';

/**
 * แถวบันทึกมือ (TOUCHPOINT · HEARD_FROM · MARKED_LOST · REOPENED) → JourneyEvent
 * ตัวแปลงเดียวของสองทาง: รายการ GET /customers/:id/journey (entries.source.ts) และคำตอบ POST /customers/:id/journey/entries
 * ⇒ ชื่อแถว ขั้น ผู้กระทำ ของสองทางหลุดจากกันไม่ได้ · ไม่มี note ทั้งใน select และในผลลัพธ์ (PDPA)
 */

/** select ของคำตอบ POST (create + ค้นแถวซ้ำด้วย dedupe_key) — createdAt = เวลาเขียนแถวของเซิร์ฟเวอร์ (ไม่ใช่ PII) · ห้ามเพิ่ม note */
export const MANUAL_ENTRY_EVENT_SELECT = {
  id: true,
  kind: true,
  origin: true,
  occurredAt: true,
  createdAt: true,
  actorType: true,
  roomId: true,
  channel: true,
  outcome: true,
  lostReason: true,
  heardFrom: true,
  actorUser: { select: { id: true, name: true } },
} satisfies Prisma.CustomerJourneyEntrySelect;

/** ช่องขั้นต่ำที่ตัวแปลงอ่าน — แถวจาก entries.source.ts (select กว้างกว่า) และจาก MANUAL_ENTRY_EVENT_SELECT เข้ารูปนี้ได้ทั้งคู่ */
export interface ManualEntryEventRow {
  id: string;
  kind: string;
  origin: string;
  occurredAt: Date;
  actorType: string;
  roomId: string | null;
  channel: string | null;
  outcome: string | null;
  lostReason: string | null;
  heardFrom: string | null;
  actorUser: { id: string; name: string } | null;
}

const MANUAL_KINDS: ReadonlySet<string> = new Set<string>(JOURNEY_ENTRY_KINDS.MANUAL);
export const isManualEntryKind = (kind: string): kind is JourneyManualEntryKind => MANUAL_KINDS.has(kind);

/** รหัสจากคอลัมน์ VARCHAR ที่ไม่มีในชุดป้าย (รวมคีย์ของ prototype เช่น toString) → คำกลาง · ห้ามแสดงรหัสดิบ */
function labelOf(labels: Readonly<Record<string, string>>, code: string | null, fallback: string): string {
  return code !== null && Object.prototype.hasOwnProperty.call(labels, code) ? labels[code] : fallback;
}

/** ชื่อแถว — ต่อคำตรง ๆ ตามที่ส่งแล้ว (ไม่มีช่องว่างหลัง "ทาง" / "จาก") ตรงกับกระดาน TimelineRows */
export function manualEntryTitle(row: Pick<ManualEntryEventRow, 'kind' | 'channel' | 'outcome' | 'lostReason' | 'heardFrom'>): string {
  if (row.kind === 'TOUCHPOINT') {
    return `ติดต่อทาง${labelOf(JOURNEY_TOUCH_CHANNEL_LABELS, row.channel, 'อื่น ๆ')}: ${labelOf(JOURNEY_TOUCH_OUTCOME_LABELS, row.outcome, 'บันทึกแล้ว')}`;
  }
  if (row.kind === 'HEARD_FROM') return `ลูกค้าบอกว่ารู้จักร้านจาก${labelOf(JOURNEY_HEARD_FROM_LABELS, row.heardFrom, 'อื่น ๆ')}`;
  if (row.kind === 'MARKED_LOST') return `ติดป้ายหลุด: ${labelOf(JOURNEY_LOST_REASON_LABELS, row.lostReason, 'อื่น ๆ')}`;
  return 'เปิดใหม่'; // REOPENED — kind มือที่เหลือ (ผู้เรียกกรองด้วย isManualEntryKind แล้ว)
}

/**
 * actor = ผู้ขอ (บทบาทตัดสินลิงก์ห้องแชท — ACCOUNTANT ไม่ได้ลิงก์) · now = เวลาของคำขอ (Task 8 ใช้คำนวณหน้าต่างเลิกทำ)
 * กลุ่ม chat ทุก kind · ขั้น INTERESTED เฉพาะ TOUCHPOINT นัดแล้ว/มาร้านแล้ว · ไม่มี metadata (JOURNEY_DATA_SCHEMAS ของ kind มือเป็น noData)
 */
export function manualEntryToEvent(row: ManualEntryEventRow, actor: JourneyActor, now: Date): JourneyEvent {
  const type = asActorType(row.actorType);
  const href = row.roomId && roleSeesGroup(actor.role, 'chat') ? `/inbox/${row.roomId}` : undefined;
  return {
    id: `entry-${row.id}`,
    type: row.kind,
    group: 'chat',
    stage: row.kind === 'TOUCHPOINT' && (row.outcome === 'APPOINTED' || row.outcome === 'VISITED') ? 'INTERESTED' : null,
    timestamp: row.occurredAt.toISOString(),
    title: manualEntryTitle(row),
    actor: row.actorUser ? { type, id: row.actorUser.id, name: row.actorUser.name } : { type },
    reliability: 'exact',
    origin: row.origin === 'MANUAL' ? 'MANUAL' : 'SYSTEM_ENTRY',
    ...(href ? { href } : {}),
  };
}

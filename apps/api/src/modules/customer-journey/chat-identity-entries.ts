import type { JourneyEntryInput } from './journey-entry-writer.service';
import {
  journeyDedupeKey,
  type ContactAddedVia,
  type ContactField,
  type HandoffPriority,
  type HandoffReasonCode,
  type LineLinkChannel,
  type LineLinkedVia,
} from './journey-data-schemas';

/**
 * แถว SYSTEM ของการเดินทางลูกค้า 4 ชนิดที่เกิดจากแชทและการยืนยันตัวตน (เฟส 1 ไม่มีงานกรอกมือ)
 * วันนี้ระบบไม่ได้เก็บเป็นโครงสร้าง จึงเก็บ exact ตั้งแต่ deploy และไม่ย้อนหลัง
 * รูป data และ dedupeKey มาจากตารางกลางของ Task 2 (journey-data-schemas.ts) — ห้ามประกาศรูปของตัวเอง
 *
 * PDPA: ห้ามรับหรือเก็บข้อความแชท (summary ของ handoff), ข้อความเหตุผลส่งต่อ, เบอร์, เลขบัตร, ที่อยู่, LINE user id, Facebook PSID
 */

/**
 * ข้อความเหตุผลที่โค้ดส่งเข้า HandoffManagerService.initiateHandoff (message-router.service.ts) → รหัสปิด
 * domain handler อาจส่งข้อความที่ AI เขียน (มีชื่อ/เบอร์/ที่อยู่ได้) จึงไม่เก็บข้อความเลย ข้อความที่ไม่รู้จัก = OTHER
 * เพิ่มข้อความใหม่ในผู้เรียกเมื่อไร ให้เพิ่มแถวที่นี่ (เทสตรวจว่าทุกข้อความในตารางยังอยู่ในโค้ดผู้เรียก)
 */
export const HANDOFF_REASON_CODE_BY_TEXT: Readonly<Record<string, HandoffReasonCode>> = {
  'ส่งคำตอบบอทไม่สำเร็จ — ให้พนักงานติดต่อลูกค้า': 'BOT_SEND_FAILED',
  'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน': 'LOW_CONFIDENCE',
  'ระบบ AI ขัดข้อง — ส่งต่อให้พนักงาน': 'AI_ERROR',
  'ลูกค้าขอพูดกับพนักงาน': 'CUSTOMER_REQUEST',
};

export function handoffReasonCode(reason: string): HandoffReasonCode {
  const key = reason.trim();
  return Object.prototype.hasOwnProperty.call(HANDOFF_REASON_CODE_BY_TEXT, key) ? HANDOFF_REASON_CODE_BY_TEXT[key] : 'OTHER';
}

/** แถวเก่าบางเส้นทางเก็บเบอร์เป็น '' แทน null — นับว่ายังไม่มี */
export function isBlankContact(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

export function botHandoffEntry(input: {
  customerId: string;
  roomId: string;
  reason: string;
  priority: HandoffPriority;
  taggedAt: Date;
}): JourneyEntryInput {
  return {
    customerId: input.customerId,
    kind: 'BOT_HANDOFF',
    occurredAt: input.taggedAt,
    actorType: 'BOT',
    actorUserId: null,
    roomId: input.roomId,
    refType: null,
    refId: null,
    data: { priority: input.priority, reasonCode: handoffReasonCode(input.reason) },
    dedupeKey: journeyDedupeKey('BOT_HANDOFF', input.roomId, input.taggedAt.getTime()),
  };
}

export function contactAddedEntry(input: {
  customerId: string;
  fields: ContactField[];
  via: ContactAddedVia;
  actorUserId: string | null;
  occurredAt: Date;
}): JourneyEntryInput {
  const fields = Array.from(new Set(input.fields)).sort();
  const byBot = input.via === 'CAPTURE_LEAD';
  return {
    customerId: input.customerId,
    kind: 'CONTACT_ADDED',
    occurredAt: input.occurredAt,
    actorType: byBot ? 'BOT' : 'STAFF',
    actorUserId: byBot ? null : input.actorUserId,
    roomId: null,
    refType: null,
    refId: null,
    data: { fields, via: input.via },
    // DTO ห้ามล้างเบอร์ของคนที่มีเบอร์แล้ว ⇒ "ได้เบอร์ครั้งแรก" เกิดครั้งเดียวต่อคนต่อชุดช่อง
    dedupeKey: journeyDedupeKey('CONTACT_ADDED', input.customerId, fields.join('+')),
  };
}

export function lineLinkedEntry(input: {
  customerId: string;
  channel: LineLinkChannel;
  via: LineLinkedVia;
  occurredAt: Date;
}): JourneyEntryInput {
  return {
    customerId: input.customerId,
    kind: 'LINE_LINKED',
    occurredAt: input.occurredAt,
    actorType: 'CUSTOMER',
    actorUserId: null,
    roomId: null,
    refType: null,
    refId: null,
    data: { channel: input.channel, via: input.via },
    // ผู้เรียกบันทึกเฉพาะการผูกที่เปลี่ยนจริง ⇒ เวลาผูกแยกรอบผูก → ยกเลิก → ผูกใหม่ ได้คนละแถว
    dedupeKey: journeyDedupeKey('LINE_LINKED', input.channel, input.customerId, input.occurredAt.getTime()),
  };
}

export function productLinkClickEntry(input: {
  customerId: string;
  roomId: string;
  productId: string;
  occurredAt: Date;
}): JourneyEntryInput {
  return {
    customerId: input.customerId,
    kind: 'PRODUCT_LINK_CLICK',
    occurredAt: input.occurredAt,
    actorType: 'CUSTOMER',
    actorUserId: null,
    roomId: input.roomId,
    refType: 'product',
    refId: input.productId,
    data: { productId: input.productId },
    // เวลาเป็นเวลา event ของ Meta — ส่งซ้ำ (redelivery) ได้ค่าเดิม จึงไม่เกิดแถวซ้ำ
    dedupeKey: journeyDedupeKey('PRODUCT_LINK_CLICK', input.roomId, input.productId, input.occurredAt.getTime()),
  };
}

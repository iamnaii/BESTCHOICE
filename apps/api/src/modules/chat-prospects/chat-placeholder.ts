import { ChatChannel } from '@prisma/client';
import { CHAT_SOURCE_PREFIX } from '@installment/shared';

/**
 * "ผู้สนใจอัตโนมัติ" (placeholder) — แถว customers ที่ระบบสร้างจากห้องแชทเอง
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.1)
 * นิยามเดียว ใช้ทุกที่: ที่มาขึ้นต้น CHAT_ และยังไม่มีทั้งเบอร์และเลขบัตร
 * พอเติมอย่างใดอย่างหนึ่ง = ผู้สนใจธรรมดา (ที่มายังเป็น CHAT_* เพื่อการตลาด)
 */
export interface PlaceholderShape {
  acquisitionSource: string | null;
  phone: string | null;
  nationalId: string | null;
}

export function isChatPlaceholder(c: PlaceholderShape): boolean {
  return !!c.acquisitionSource?.startsWith(CHAT_SOURCE_PREFIX) && c.phone == null && c.nationalId == null;
}

/**
 * select ขั้นต่ำที่ต้องใช้คู่กับ isLivePlaceholder — ใช้ให้ทุกที่ที่ต้อง query
 * มาเช็คว่า "ห้องนี้ผูกกับ placeholder ที่ยังมีชีวิตอยู่ไหม" ใช้ select เดียวกัน
 * ไม่เขียนซ้ำ (R6)
 */
export const PLACEHOLDER_FIELDS_SELECT = {
  acquisitionSource: true,
  phone: true,
  nationalId: true,
  deletedAt: true,
} as const;

/** placeholder ที่ยังไม่ถูก soft-delete (ยังไม่ถูกรวมเข้าคนจริง) และไม่ใช่ null/undefined */
export function isLivePlaceholder(
  c: (PlaceholderShape & { deletedAt: Date | null }) | null | undefined,
): boolean {
  return !!c && !c.deletedAt && isChatPlaceholder(c);
}

export const CHANNEL_LABEL: Record<ChatChannel, string> = {
  FACEBOOK: 'Facebook',
  LINE_SHOP: 'LINE',
  LINE_FINANCE: 'LINE',
  TIKTOK: 'TikTok',
  WEB: 'เว็บ',
};

/** ชื่อของ placeholder: ชื่อโปรไฟล์จากห้อง ไม่มีก็ "<ป้ายช่องทาง> #<รหัสผู้ใช้ 4 ตัวท้าย>" */
export function placeholderName(channel: ChatChannel, externalKey: string, displayName?: string | null): string {
  const trimmed = (displayName ?? '').trim();
  if (trimmed) return trimmed;
  return `${CHANNEL_LABEL[channel]} #${externalKey.slice(-4)}`;
}

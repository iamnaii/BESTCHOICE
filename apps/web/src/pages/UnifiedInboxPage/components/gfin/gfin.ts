import {
  FINANCE_SLOT_LABELS,
  FINANCE_SLOT_ORDER,
  FINANCE_REQUIRED_SLOTS,
  FINANCE_PRIMARY_SLOTS,
  type FinanceDocSlot,
} from '@installment/shared';

export const GFIN_MESSAGE_MIME = 'application/x-bestchoice-gfin-message';
export const GFIN_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp';
export const GFIN_LINE_GROUP = 'GFIN : BESTCHOICE (67301219)';
export const GFIN_WEB_FORM_URL = 'https://client.gfinn.xyz/shop/loans/request';

/** ชนิดช่องเอกสาร — re-export ของ `FinanceDocSlot` จาก @installment/shared (Task 2) เพื่อไม่ให้ Tasks 9–10 ต้องแก้ import */
export type FinanceSlot = FinanceDocSlot;
export type FinanceStatus = 'DRAFT' | 'SENT' | 'ACKNOWLEDGED' | 'MORE_INFO' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type FinanceEventKind = 'CREATED' | 'SENT' | 'RESENT' | 'LINK_VIEWED' | 'LINK_EXTENDED' | 'LINK_REVOKED' | 'PARTNER_ACK' | 'PARTNER_MORE_INFO' | 'PARTNER_APPROVED' | 'PARTNER_REJECTED' | 'STAFF_RESULT' | 'CANCELLED' | 'FILES_PURGED';

/** ป้ายช่อง — มาจากผัง `@installment/shared` เดียวกับฝั่ง API (constants.ts) — ห้ามประกาศซ้ำที่นี่ */
export const SLOT_LABELS = FINANCE_SLOT_LABELS;
export const SLOT_ORDER = FINANCE_SLOT_ORDER;
/** 9 ช่องหลักที่โชว์เสมอ (mockup ขั้น 3 "8/9 ช่อง") — ที่เหลือโผล่เมื่อกด "เพิ่มช่อง" หรือมีไฟล์แล้ว */
export const PRIMARY_SLOTS = FINANCE_PRIMARY_SLOTS;
export const REQUIRED_SLOTS = FINANCE_REQUIRED_SLOTS;
export const STATUS_LABEL: Record<FinanceStatus, string> = {
  DRAFT: 'ร่าง', SENT: 'ส่งแล้ว รอ GFIN', ACKNOWLEDGED: 'GFIN รับเรื่องแล้ว', MORE_INFO: 'GFIN ขอเพิ่ม',
  APPROVED: 'ผ่าน', REJECTED: 'ไม่ผ่าน', CANCELLED: 'ยกเลิก',
};
export const OPEN_STATUSES: FinanceStatus[] = ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO'];

export interface FinanceFile { id: string; slot: FinanceSlot; mimeType: string; size: number; originalName: string | null; source: 'CHAT_MESSAGE' | 'UPLOAD' | 'PRODUCT_PHOTO'; sourceMessageId: string | null; sourceAngle: string | null; sortOrder: number; sentAt: string | null; createdAt: string }
export interface FinanceEvent { id: string; kind: FinanceEventKind; actorType: 'STAFF' | 'PARTNER' | 'SYSTEM'; actorUserId: string | null; actorName: string | null; note: string | null; meta: Record<string, unknown> | null; createdAt: string }
export interface FinanceApplication {
  id: string; number: string; status: FinanceStatus; roomId: string; customerId: string | null; productId: string | null;
  customer: { id: string; name: string; phone: string | null; occupation: string | null; birthDate: string | null } | null;
  product: { id: string; name: string | null; brand: string | null; model: string | null; storage: string | null; color: string | null; imeiSerial: string | null; category: string | null; status: string } | null;
  occupationOverride: string | null; messageOverride: string | null; messageText: string | null;
  sentAt: string | null; sentVia: 'BOT' | 'COPY' | null; resultSource: 'PARTNER_LINK' | 'STAFF' | null;
  shareExpiresAt: string | null; shareRevokedAt: string | null; shareViewCount: number; shareLastViewedAt: string | null;
  lastPartnerEventAt: string | null; closedAt: string | null; files: FinanceFile[]; events: FinanceEvent[]; createdAt: string;
}
export type PrecheckField = 'customerName' | 'occupation' | 'model' | 'hand' | 'imei' | 'phone' | 'age';
export const FIELD_LABELS: Record<PrecheckField, string> = { customerName: 'ชื่อลูกค้า', occupation: 'อาชีพ', model: 'รุ่น', hand: 'มือ 1/2', imei: 'IMEI', phone: 'เบอร์โทร', age: 'อายุ (วันเกิด)' };
export interface FinancePreview { text: string; values: Record<string, unknown>; missingFields: PrecheckField[]; missingRequiredSlots: FinanceSlot[]; warnings: string[]; canSend: boolean }

export function isGfinPickable(message: { type?: string | null; mediaUrl?: string | null; externalMessageId?: string | null }): boolean {
  if (message.type !== 'IMAGE' && message.type !== 'FILE') return false;
  return !!message.mediaUrl || !!message.externalMessageId;
}
const CUSTOMER_FIELDS: PrecheckField[] = ['customerName', 'occupation', 'phone', 'age'];
export function gfinStep(app: FinanceApplication | null, preview: FinancePreview | null): 1 | 2 | 3 | 4 {
  if (!app?.customerId) return 1;
  if (preview?.missingFields?.some((f) => CUSTOMER_FIELDS.includes(f))) return 1;
  if (!app.productId) return 2;
  if (!preview || (preview.missingRequiredSlots?.length ?? 0) > 0) return 3;
  return 4;
}
export function slotCounts(files: FinanceFile[]): Record<FinanceSlot, number> {
  const counts = Object.fromEntries(SLOT_ORDER.map((s) => [s, 0])) as Record<FinanceSlot, number>;
  for (const f of files) counts[f.slot] += 1;
  return counts;
}
/** จุดเหลืองบนแท็บ (spec §6.1): มีเหตุการณ์จาก GFIN ที่ใหม่กว่าครั้งล่าสุดที่ผู้ใช้เปิดแท็บ (`seenAt` จาก localStorage) */
export function needsAttention(app: FinanceApplication | null, seenAt: string | null = null): boolean {
  if (!app || !app.lastPartnerEventAt) return false;
  return !seenAt || new Date(app.lastPartnerEventAt) > new Date(seenAt);
}
const SEEN_KEY = (appId: string) => `gfin-seen:${appId}`;
export function readSeen(appId: string): string | null { try { return localStorage.getItem(SEEN_KEY(appId)); } catch { return null; } }
export function markSeen(app: FinanceApplication | null): void { if (!app?.lastPartnerEventAt) return; try { localStorage.setItem(SEEN_KEY(app.id), app.lastPartnerEventAt); } catch { /* private mode */ } }
export const productLabel = (p: FinanceApplication['product']) => p ? [p.name || `${p.brand ?? ''} ${p.model ?? ''}`.trim(), p.storage && !(p.name ?? '').includes(p.storage) ? p.storage : null, p.color].filter(Boolean).join(' · ') : '';
export const imeiTail = (imei: string | null | undefined) => (imei ? `IMEI …${imei.slice(-4)}` : '');

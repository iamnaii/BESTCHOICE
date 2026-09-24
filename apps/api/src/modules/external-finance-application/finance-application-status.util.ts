import { ConflictException } from '@nestjs/common';
import { ExternalFinanceApplicationStatus as S } from '@prisma/client';

export type FinanceTransitionEvent =
  | 'SEND'
  | 'RESEND'
  | 'PARTNER_ACK'
  | 'PARTNER_MORE_INFO'
  | 'PARTNER_APPROVED'
  | 'PARTNER_REJECTED'
  | 'STAFF_MORE_INFO'
  | 'STAFF_APPROVED'
  | 'STAFF_REJECTED'
  | 'CANCEL';

const OPEN_AFTER_SEND: S[] = ['SENT', 'ACKNOWLEDGED', 'MORE_INFO'];
const CLOSED: S[] = ['APPROVED', 'REJECTED', 'CANCELLED'];

/** ตาราง spec §9 — คู่ (สถานะปัจจุบัน, เหตุการณ์) ที่อนุญาต */
const TABLE: Record<FinanceTransitionEvent, { from: S[]; to: S }> = {
  SEND: { from: ['DRAFT'], to: 'SENT' },
  RESEND: { from: ['MORE_INFO', 'SENT', 'ACKNOWLEDGED'], to: 'SENT' },
  PARTNER_ACK: { from: ['SENT'], to: 'ACKNOWLEDGED' },
  PARTNER_MORE_INFO: { from: OPEN_AFTER_SEND, to: 'MORE_INFO' },
  PARTNER_APPROVED: { from: OPEN_AFTER_SEND, to: 'APPROVED' },
  PARTNER_REJECTED: { from: OPEN_AFTER_SEND, to: 'REJECTED' },
  STAFF_MORE_INFO: { from: OPEN_AFTER_SEND, to: 'MORE_INFO' },
  STAFF_APPROVED: { from: [...OPEN_AFTER_SEND, 'REJECTED'], to: 'APPROVED' },
  STAFF_REJECTED: { from: [...OPEN_AFTER_SEND, 'APPROVED'], to: 'REJECTED' },
  CANCEL: { from: ['DRAFT', ...OPEN_AFTER_SEND], to: 'CANCELLED' },
};

const THAI: Record<S, string> = {
  DRAFT: 'ร่าง',
  SENT: 'ส่งแล้ว',
  ACKNOWLEDGED: 'GFIN รับเรื่องแล้ว',
  MORE_INFO: 'GFIN ขอเอกสารเพิ่ม',
  APPROVED: 'ผ่าน',
  REJECTED: 'ไม่ผ่าน',
  CANCELLED: 'ยกเลิก',
};

export function isClosed(status: S): boolean {
  return CLOSED.includes(status);
}

export function applyTransition(status: S, event: FinanceTransitionEvent): S {
  const rule = TABLE[event];
  if (!rule.from.includes(status)) {
    throw new ConflictException(`ใบยื่นอยู่ในสถานะ "${THAI[status]}" ทำรายการนี้ไม่ได้`);
  }
  return rule.to;
}

export const FINANCE_STATUS_LABEL = THAI;

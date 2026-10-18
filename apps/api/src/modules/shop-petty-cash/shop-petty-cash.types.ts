import type { PettyCashRowKind } from './shop-petty-cash.util';

/** รูปที่ API ส่งให้หน้าเว็บ — ยอดเงินเป็นสตริงทศนิยม 2 ตำแหน่ง (Decimal) · วันที่ ISO */
export interface ShopPettyCashLimitView {
  value: string;
  /** DEFAULT = ยังไม่เคยตั้ง ใช้ 20,000 · SET = เจ้าของตั้งแล้ว */
  source: 'DEFAULT' | 'SET';
  updatedAt: string | null;
}

export interface ShopPettyCashAmountCount {
  amount: string;
  count: number;
}

export interface ShopPettyCashMonthView {
  /** YYYY-MM */
  key: string;
  /** "ตุลาคม 2569" */
  label: string;
  opening: string;
  closing: string;
  topUps: ShopPettyCashAmountCount;
  returns: ShopPettyCashAmountCount;
  supplierPayments: ShopPettyCashAmountCount;
  /** รายการอื่น (JE มือ ฯลฯ) — ยอดเป็น**สุทธิ** มีเครื่องหมาย (เข้า − ออก) เพราะมีได้ทั้งสองทิศ */
  other: ShopPettyCashAmountCount;
  /** closing − opening */
  net: string;
}

export interface ShopPettyCashSummary {
  accountCode: string;
  balance: string;
  limit: ShopPettyCashLimitView;
  /** เติมได้อีก = วงเงิน − คงเหลือ (ไม่ติดลบ) */
  headroom: string;
  /** คงเหลือเกินวงเงิน (ไม่ติดลบ) — หลังลดวงเงิน */
  overLimit: string;
  month: ShopPettyCashMonthView;
  banks: { code: string; label: string }[];
  defaultBank: { TOP_UP: string; RETURN: string };
  asOf: string;
}

export interface ShopPettyCashRow {
  /** id ของบรรทัดบัญชี */
  id: string;
  journalEntryId: string;
  journalEntryNo: string;
  /** วันที่ลงบัญชี (ISO) */
  date: string;
  kind: PettyCashRowKind;
  label: string;
  bankAccountCode: string | null;
  bankLabel: string | null;
  po: { id: string; number: string; supplierName: string } | null;
  movementId: string | null;
  hasEvidence: boolean;
  note: string | null;
  inAmount: string;
  outAmount: string;
  balanceAfter: string;
  createdByName: string | null;
}

export interface ShopPettyCashMovementsPage {
  month: { key: string; label: string };
  opening: string;
  closing: string;
  rows: ShopPettyCashRow[];
}

export interface ShopPettyCashMovementView {
  id: string;
  kind: 'TOP_UP' | 'RETURN';
  amount: string;
  bankAccountCode: string;
  bankLabel: string;
  movedAt: string;
  postedAt: string;
  note: string | null;
  hasEvidence: boolean;
  journalEntryNo: string | null;
  createdAt: string;
}

export interface ShopPettyCashRecordResult {
  movement: ShopPettyCashMovementView;
  /** งวดของวันที่ที่เลือกปิดแล้ว → ลงวันที่บันทึกแทน + แจ้งฝ่ายบัญชี */
  periodClosed: boolean;
  accountingNotified: boolean;
  /** คำขอเดิมส่งซ้ำ — คืนรายการที่บันทึกไปแล้ว */
  duplicate: boolean;
  summary: ShopPettyCashSummary;
}

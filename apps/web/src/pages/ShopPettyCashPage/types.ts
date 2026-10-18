/** รูปจาก API `/shop/petty-cash/*` (apps/api/src/modules/shop-petty-cash/shop-petty-cash.types.ts) — ยอดเงินเป็นสตริงทศนิยม 2 ตำแหน่ง */
export type PettyCashMovementKind = 'TOP_UP' | 'RETURN';
export type PettyCashRowKind = PettyCashMovementKind | 'SUPPLIER_PAYMENT' | 'SUPPLIER_PAYMENT_REVERSAL' | 'OTHER';

export interface PettyCashAmountCount {
  amount: string;
  count: number;
}

export interface PettyCashMonth {
  key: string;
  label: string;
  opening: string;
  closing: string;
  topUps: PettyCashAmountCount;
  returns: PettyCashAmountCount;
  supplierPayments: PettyCashAmountCount;
  /** สุทธิ มีเครื่องหมาย (เข้า − ออก) */
  other: PettyCashAmountCount;
  net: string;
}

export interface PettyCashSummary {
  accountCode: string;
  balance: string;
  limit: { value: string; source: 'DEFAULT' | 'SET'; updatedAt: string | null };
  headroom: string;
  overLimit: string;
  month: PettyCashMonth;
  banks: { code: string; label: string }[];
  defaultBank: { TOP_UP: string; RETURN: string };
  asOf: string;
}

export interface PettyCashRow {
  id: string;
  journalEntryId: string;
  journalEntryNo: string;
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

export interface PettyCashMovementsPage {
  month: { key: string; label: string };
  opening: string;
  closing: string;
  rows: PettyCashRow[];
}

export interface PettyCashMovementView {
  id: string;
  kind: PettyCashMovementKind;
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

export interface PettyCashRecordResult {
  movement: PettyCashMovementView;
  periodClosed: boolean;
  accountingNotified: boolean;
  duplicate: boolean;
  summary: PettyCashSummary;
}

/** สิ่งที่กล่องเติม/คืนส่งให้หน้า — หน้าแปลงเป็น multipart เอง */
export interface PettyCashMovementPayload {
  amount: number;
  bankAccountCode: string;
  /** YYYY-MM-DD */
  movedAt: string;
  note?: string;
  requestId: string;
  evidence: File | null;
}


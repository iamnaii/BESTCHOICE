/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — shared types + small formatters used
 * across the 2-tab page (`IntercompanySettlementPage.tsx` + `interco/*`).
 *
 * Money fields come back from the API as strings — Prisma `Decimal` (`decimal.js`)
 * serializes via `toJSON()` → string, never a JS number (same convention as
 * `YearEndClosingPage`'s `AccountRow.balance: string`) — never parse with
 * `Number()` and re-serialize without `formatNumberDecimal`, precision matters.
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §3, §4, §8
 */

export interface PendingContract {
  contractId: string;
  contractNumber: string;
  customerName: string;
  activatedAt: string | null;
  /** เลนส์ 21-1101 — เจ้าหนี้ยอดจัดคงเหลือ */
  financedGl: string;
  /** เลนส์ 21-1102 — เจ้าหนี้ค่าคอมคงเหลือ */
  commissionGl: string;
  /** เลนส์ S11-3001 — ลูกหนี้ FINANCE (ยอดจัด) ฝั่ง SHOP */
  shopFinancedGl: string;
  /** เลนส์ S11-3002 — ลูกหนี้ FINANCE (ค่าคอม) ฝั่ง SHOP */
  shopCommissionGl: string;
  /** true เมื่อ GL ฝั่ง SHOP (S11-3001/S11-3002) ของสัญญานี้ = 0 ทั้งคู่ */
  legacyNoShop: boolean;
  /** เลนส์ 11-2107 SWAP_CREDIT — เครดิตเปลี่ยนเครื่องรอหักกลบ */
  swapCreditGl: string;
  /** เลนส์ S21-3001 — ขาคู่ฝั่ง SHOP */
  shopBuybackPayableGl: string;
  /** หักกลบได้ (สองสมุดมียอดเท่ากัน) — false บน swap ยุคก่อน Phase 1 */
  swapCreditEligible: boolean;
}

/**
 * แถวคิวหักเรียกคืน (Flow C-2 — ยกเลิกเปลี่ยนเครื่องหลังตัดจ่ายรอบไปแล้ว):
 * 11-2107 [PAYOUT_RECALL] ค้าง — เลือกเป็น "แถวหัก" เข้ารอบจ่ายได้
 * (ไม่มีเจ้าหนี้ 21-1101/21-1102 ของตัวเอง).
 */
export interface RecallCandidate {
  contractId: string;
  contractNumber: string;
  customerName: string;
  recallGl: string;
  shopRecallGl: string;
}

export interface ReconcileTotals {
  pendingTotal: string;
  glFinanceTotal: string;
  glShopTotal: string;
  drift: string;
}

export interface PendingResponse {
  pending: PendingContract[];
  recalls: RecallCandidate[];
  reconcile: ReconcileTotals;
}

/**
 * แถวรายงานอายุลูกหนี้-หน้าร้าน (Phase 4 — `GET /interco-settlement/shop-receivable-aging`).
 * Mirror ของ `ShopReceivableAgingRow` ฝั่ง API (Decimal → string, Date → ISO string).
 */
export interface ShopReceivableAgingRow {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /** 11-2107 typed SWAP_CREDIT gross (Dr−Cr) */
  swapCreditGross: string;
  /** 11-2107 typed PAYOUT_RECALL gross (Dr−Cr) */
  payoutRecallGross: string;
  /** Σ (swapCreditAmount + recallAmount) ของ item ทุกประเภทใน batch POSTED */
  settledDeduction: string;
  /** กลุ่มระหว่างกิจการคงเหลือจริง = swapCreditGross + payoutRecallGross − settledDeduction */
  intercoNet: string;
  /** SHOP_COLLECT — เงินลูกค้าที่หน้าร้านรับแทน (คนละกลุ่มกับ interco) */
  shopCollect: string;
  /** กระจกฝั่ง SHOP (S21-3001 − deduction) — คู่เทียบของ intercoNet */
  shopMirrorNet: string;
  intercoOldestPostedAt: string | null;
  intercoAgeDays: number | null;
  shopCollectOldestPostedAt: string | null;
  shopCollectAgeDays: number | null;
  /** |intercoNet − shopMirrorNet| > 0.01 — คณิตศาสตร์ล้วน (แถว legacy ก็ true ได้) */
  bookMismatch: boolean;
  legacySwapGross: string;
  /** swap ยุคก่อนระบบสองสมุด (spec §11.4) — สภาพปกติ ไม่ใช่ anomaly */
  legacyOneBook: boolean;
}

export interface ShopReceivableAgingResponse {
  rows: ShopReceivableAgingRow[];
  /** วันที่ใช้คำนวณ "อายุ" เท่านั้น — ยอดคงเหลือเป็นปัจจุบันเสมอ */
  asOf: string;
  /** ไม่รวมแถว legacyOneBook — หนี้ legacy จริงรายงานแยกใน legacyOneBookNet */
  totals: {
    intercoNet: string;
    shopCollect: string;
    overdueCount: number;
    legacyOneBookNet: string;
  };
}

/**
 * แถวคู่เจ้าหนี้ FINANCE ↔ ลูกหนี้ SHOP ที่ **ไม่ตรงกัน** —
 * `GET /interco-settlement/reconcile-findings` (Phase 5 Task 5 ข้อ 1).
 * Mirror ของ `PayablePairMismatchRow` ฝั่ง API (Decimal → string).
 */
export interface PayablePairMismatchRow {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /** 21-1101 (Cr−Dr) — เจ้าหนี้ยอดจัด */
  financedGl: string;
  /** 21-1102 (Cr−Dr) — เจ้าหนี้ค่าคอม */
  commissionGl: string;
  /** S11-3001 (Dr−Cr) — ลูกหนี้ FINANCE ยอดจัด ฝั่ง SHOP */
  shopFinancedGl: string;
  /** S11-3002 (Dr−Cr) — ลูกหนี้ FINANCE ค่าคอม ฝั่ง SHOP */
  shopCommissionGl: string;
  legacyNoShop: boolean;
  financedDiff: string;
  commissionDiff: string;
  diff: string;
  mismatch: boolean;
  /**
   * ต่างเฉพาะขาค่าคอม = รูปแบบที่รู้จัก (สัญญาไม่ระบุค่าคอม: 1A ตั้ง fallback
   * 10% แต่สมุด SHOP ตั้ง 0). **คำนวณฝั่ง server** (`isCommissionOnlyGap`) —
   * ตัวเดียวกับที่ใบ Todo รายเดือนใช้ยุบเป็นบรรทัดสรุป ห้ามคำนวณซ้ำที่นี่
   */
  commissionOnly: boolean;
}

/** ช่องที่ยอดติดลบหนึ่งช่อง (จาก predicate `negativeTypedFields` ฝั่ง server) */
export interface NegativeTypedField {
  field: string;
  label: string;
  value: string;
}

/** แถวยอดติดลบ = แถวรายงานอายุ + ช่องที่ติดลบซึ่ง server คำนวณมาให้ */
export interface NegativeTypedRow extends ShopReceivableAgingRow {
  negativeFields: NegativeTypedField[];
}

export interface ReconcileFindingsResponse {
  asOf: string;
  pairMismatches: PayablePairMismatchRow[];
  negativeRows: NegativeTypedRow[];
}

/** kind ของ finding จาก reconcile cron — ตรงกับ `ReconcileFindingKind` ฝั่ง API */
export type ReconcileFindingKind =
  | 'BOOK_MISMATCH'
  | 'SWAP_CREDIT_ONE_BOOK'
  | 'PAYABLE_PAIR_MISMATCH'
  | 'NEGATIVE_TYPED'
  | 'ACCOUNT_DRIFT';

/** ป้ายไทยของแต่ละ kind — ต้องตรงกับ KIND_LABEL ใน interco-reconcile.cron.ts */
export const RECONCILE_KIND_LABEL: Record<ReconcileFindingKind, string> = {
  BOOK_MISMATCH: 'สองสมุดไม่ตรงกัน',
  SWAP_CREDIT_ONE_BOOK: 'เครดิตเปลี่ยนเครื่องค้างสมุดเดียว',
  PAYABLE_PAIR_MISMATCH: 'เจ้าหนี้/ลูกหนี้รอบจ่ายไม่ตรงกัน',
  NEGATIVE_TYPED: 'ยอดติดลบ (ล้างเกิน)',
  ACCOUNT_DRIFT: 'ยอดบัญชีอธิบายไม่ได้',
};

/** ผลลัพธ์ `POST /interco-settlement/reconcile/run` (สั่งรันกระทบยอดเอง) */
export interface ReconcileRunResponse {
  /** false = kill switch `interco_reconcile_enabled` ปิดอยู่ — tick ไม่ทำอะไรเลย */
  enabled: boolean;
  /**
   * true = รอบนี้พัง (DB/service) ⇒ ผลไม่ครบ. **ต้องเช็คก่อน `enabled` เสมอ**:
   * สองสถานะนี้มีวิธีแก้คนละทาง (ลองใหม่/แจ้งผู้ดูแล vs เปิดค่าใน SystemConfig)
   * และการสลับกันจะส่งคนไปแก้ค่าที่ถูกอยู่แล้ว.
   */
  failed?: boolean;
  /** false = เดือนนี้มีใบงานค้างอยู่แล้ว (dedup) หรือไม่มีสิ่งผิดปกติ */
  todoCreated: boolean;
  total: number;
  counts: Partial<Record<ReconcileFindingKind, number>>;
  findings: Array<{ kind: ReconcileFindingKind; contractNumber?: string; detail: string }>;
}

/** เกณฑ์วันค้าง default — ต้องตรงกับ default ของ IntercoAgingService (30) */
export const AGING_DEFAULT_THRESHOLD_DAYS = 30;

export type InterCoBatchStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'REVERSED' | 'CANCELLED';

export interface BatchUserRef {
  id: string;
  name: string;
}

/** Row shape from `GET /interco-settlement/batches` (list). */
export interface BatchListItem {
  id: string;
  batchNumber: string;
  status: InterCoBatchStatus;
  transferDate: string;
  postedAt: string | null;
  totalFinanced: string;
  totalCommission: string;
  totalAmount: string;
  shopPostedAmount: string;
  /** Σ swapCreditAmount + recallAmount ของทุก item (Phase 2 หักกลบ) — รอบเก่า = "0.00" */
  totalDeduction: string;
  /** เงินโอนจริงฝั่ง FINANCE = totalAmount − totalDeduction; null = รอบก่อน Phase 2 */
  netTransferAmount: string | null;
  /** เงินรับจริงฝั่ง SHOP = shopPostedAmount − totalDeduction; null = รอบก่อน Phase 2 */
  shopNetAmount: string | null;
  transferRef: string | null;
  note: string | null;
  maker: BatchUserRef;
  approver: BatchUserRef | null;
  _count: { items: number };
}

export interface BatchListResponse {
  data: BatchListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface BatchItem {
  id: string;
  contractId: string;
  /** SETTLEMENT = จ่ายเจ้าหนี้ตามปกติ; RECALL = แถวหักเรียกคืน (Flow C-2, ไม่มีเจ้าหนี้ของตัวเอง) */
  itemType: 'SETTLEMENT' | 'RECALL';
  financedGl: string;
  commissionGl: string;
  shopFinancedGl: string;
  shopCommissionGl: string;
  legacyNoShop: boolean;
  /** ยอดหักเครดิตเปลี่ยนเครื่อง (11-2107 SWAP_CREDIT) — "0.00" เมื่อไม่ใช่ swap/ไม่ eligible */
  swapCreditAmount: string;
  /** ยอดหักเรียกคืน (11-2107 PAYOUT_RECALL) — > 0 เฉพาะแถว itemType RECALL */
  recallAmount: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { name: string };
  };
}

/** Full shape from `GET /interco-settlement/batches/:id`. */
export interface BatchDetail extends Omit<BatchListItem, '_count'> {
  financeBankCode: string;
  shopBankCode: string;
  slipFileKey: string | null;
  makerId: string;
  approverId: string | null;
  financeJournalEntryId: string | null;
  shopJournalEntryId: string | null;
  reverseReason: string | null;
  financeEntryNumber: string | null;
  shopEntryNumber: string | null;
  items: BatchItem[];
}

export const BATCH_STATUS_LABEL: Record<InterCoBatchStatus, string> = {
  DRAFT: 'ร่าง',
  PENDING_APPROVAL: 'รอการอนุมัติ',
  POSTED: 'อนุมัติแล้ว',
  REVERSED: 'ย้อนกลับแล้ว',
  CANCELLED: 'ยกเลิกแล้ว',
};

export const BATCH_STATUS_BADGE_VARIANT: Record<
  InterCoBatchStatus,
  'secondary' | 'warning' | 'success' | 'destructive' | 'outline'
> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'warning',
  POSTED: 'success',
  REVERSED: 'outline',
  CANCELLED: 'destructive',
};

/** Roles allowed to create/submit/withdraw/cancel/attach-slip (maker side — spec §6). */
export const INTERCO_MAKER_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER'];
/** Roles allowed to approve/reverse (checker side — spec §6). */
export const INTERCO_APPROVER_ROLES = ['OWNER', 'FINANCE_MANAGER'];

/** เงินโอนจริงของรอบ — รอบก่อน Phase 2 (null) = totalAmount เต็ม */
export function netAmountOf(b: Pick<BatchListItem, 'totalAmount' | 'netTransferAmount'>): string {
  return b.netTransferAmount ?? b.totalAmount;
}

export function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '0.00';
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
}

/**
 * Backend closed-period message shape (see `IntercoSettlementService.guardPeriodOpen`):
 * "งวดบัญชีฝั่ง {FINANCE|SHOP} ปิดแล้ว (...) — เลือกวันที่ลงบัญชี...". Used to
 * branch the approve-error handler into the D4 backdated-postedAt retry flow
 * instead of a plain error toast.
 */
export function isClosedPeriodError(message: string): boolean {
  return message.includes('งวดบัญชีฝั่ง') && message.includes('ปิดแล้ว');
}

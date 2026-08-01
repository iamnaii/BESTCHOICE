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
}

export interface ReconcileTotals {
  pendingTotal: string;
  glFinanceTotal: string;
  glShopTotal: string;
  drift: string;
}

export interface PendingResponse {
  pending: PendingContract[];
  reconcile: ReconcileTotals;
}

export type InterCoBatchStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

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
  financedGl: string;
  commissionGl: string;
  shopFinancedGl: string;
  shopCommissionGl: string;
  legacyNoShop: boolean;
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

import type { SupplierDocType } from './supplier-doc.util';
import type { AnglePhotos } from '@/constants/photo-angles';

export interface POItem {
  id: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  category: string | null;
  quantity: number;
  unitPrice: string;
  receivedQty: number;
  accessoryType: string | null;
  accessoryBrand: string | null;
  receivingItems?: {
    id: string;
    status: 'PASS' | 'REJECT';
    product: { id: string; status: string } | null;
  }[];
}

export interface GoodsReceivingItem {
  id: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  photos: string[];
  status: 'PASS' | 'REJECT';
  rejectReason: string | null;
  product: { id: string; name: string; imeiSerial: string | null; status: string } | null;
}

export interface GoodsReceivingRecord {
  id: string;
  grNumber: string;
  createdAt: string;
  notes: string | null;
  /** ข3 — เอกสารจากผู้จัดจำหน่าย (null = ใบรับของก่อนมีช่องนี้) */
  supplierDocType?: SupplierDocType | null;
  supplierDocNumber?: string | null;
  supplierDocDate?: string | null;
  receivedBy: { id: string; name: string };
  items: GoodsReceivingItem[];
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  orderedAt: string | null;
  /** Row creation time (Prisma default) — the history's "สร้าง" timestamp. */
  createdAt?: string;
  dueDate: string | null;
  status: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  discount: string;
  discountAfterVat: string;
  netAmount: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paidAmount: string;
  paymentNotes: string | null;
  attachments: string[];
  notes: string | null;
  /** บัญชีผู้รับเงินของผู้จัดจำหน่ายที่บันทึกไว้ตอนออกใบ (T5-C18) — หน้าจ่ายเงินแสดงให้เห็นว่าโอนเข้าไหน */
  bankNameSnapshot?: string | null;
  bankAccountSnapshot?: string | null;
  supplier: { id: string; name: string; contactName: string | null; phone: string; hasVat: boolean };
  createdBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
  items: POItem[];
  _count: { products: number };
}

export interface PODetail extends PurchaseOrder {
  goodsReceivings: GoodsReceivingRecord[];
}

export interface ItemForm {
  brand: string;
  category: string;
  model: string;
  color: string;
  storage: string;
  quantity: string;
  unitPrice: string;
  accessoryType: string;
  accessoryBrand: string;
  /** Row re-ordered from an existing accessory SKU (display only — not sent to the API). */
  sourceName?: string;
  sourceCode?: string | null;
  sourceInStock?: number;
}

export type DefectReasonValue =
  | 'SCREEN' | 'BATTERY' | 'IMEI_BLOCKED' | 'BOX_MISSING'
  | 'WRONG_MODEL' | 'DOA' | 'COSMETIC' | 'OTHER';

/** ผลตรวจของหนึ่งชิ้น — '' = ยังไม่ได้เลือก (จอรับทีละเครื่องบังคับกด ผ่าน/ไม่ผ่าน เอง, 2026-09-07) */
export type ReceivingStatus = 'PASS' | 'REJECT' | '';

export interface ReceivingUnitForm {
  deviceOrigin?: string; shopWarrantyDays?: string; warrantyTerms?: string;
  poItemId: string;
  label: string;
  category: string;
  imeiSerial: string;
  serialNumber: string;
  status: ReceivingStatus;
  rejectReason: string;
  defectReason: DefectReasonValue | '';
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  checklist: { item: string; category: string; passed: boolean; note: string }[];
  /** ราคาเงินสด (ราคาเต็มจำนวน) → Product.cashPrice — the field keeps its old name */
  sellingPrice: string;
  /** ราคาผ่อน → Product.installmentPrice (phones only; accessories sell at one price) */
  installmentPrice: string;
  /** รูปหลักฐานอิสระ (ตำหนิ/ความเสียหาย) → Product.photos + ใบรับของ */
  photos: string[];
  /** รูปสินค้า 6 มุม (มือสอง) → ProductPhoto — ครบ 6 + มีราคา = เข้าคลังพร้อมขายทันที */
  anglePhotos: AnglePhotos;
  /** ราคาทุน/ชิ้น — sent on direct receive; on a PO receive it is the PO line's unitPrice, shown only */
  costPrice: string;
  // Direct-receive-only product attrs (PO-based seeds leave these undefined —
  // the PO unit derives its name from the PO line; direct-receive seeds set them).
  // Required by buildDirectReceiveItem (Task 2 Step 6) + lineToUnits (Task 4 Step 2).
  brand?: string;
  model?: string;
  color?: string;
  storage?: string;
  accessoryType?: string;
  accessoryBrand?: string;
}


/**
 * Body of POST /purchase-orders/:id/approve (ApprovePODto) — approve = order, and the owner
 * may record the payment made on the spot in the same request (2026-09-06).
 */
/** ก้อน 2 (2026-10-05): อนุมัติไม่รับยอดจ่ายอีก — จ่ายผ่านปุ่มบันทึกการจ่ายหลังอนุมัติ */
export interface ApprovePOPayload {
  id: string;
  expectedDate?: string;
}

/** ซื้อสินค้า — one wizard, two ways in: order first (PO) or goods already in hand (direct receive). */
export type PurchaseMode = 'po' | 'receive';

/** The purchase wizard's form (owned by usePOForm) — shared by every step panel. */
export interface PoFormState {
  supplierId: string;
  orderDate: string;
  expectedDate: string;
  notes: string;
  discount: string;
  discountAfterVat: string;
  paymentStatus: string;
  paymentMethod: string;
  paidAmount: string;
  paymentNotes: string;
}

export interface SupplierPaymentMethodOption {
  paymentMethod: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  creditTermDays?: number;
  isDefault: boolean;
}

/** One entry of the suppliers list the page loads for the wizard. */
export interface SupplierOption {
  id: string;
  name: string;
  contactName: string | null;
  hasVat: boolean;
  paymentMethods: SupplierPaymentMethodOption[];
}

// ───────────── ก้อน 2 (2026-10-05) — จ่ายเงินผู้จัดจำหน่าย: รูปเดียวกับ API `GET /purchase-orders/:id/payments` ─────────────

export type SupplierPaymentKind = 'DEPOSIT' | 'SETTLEMENT' | 'DEPOSIT_APPLIED' | 'DEPOSIT_REFUND' | 'DEPOSIT_FORFEIT';

export interface SupplierPaymentSummary {
  netAmount: string;
  /** มัดจำ + ชำระ − มัดจำที่ได้คืน (ไม่นับรายการที่ยกเลิก) */
  paidTotal: string;
  /** เพดานที่ยังจ่ายได้ = ยอดสุทธิ − paidTotal */
  remainingOnPo: string;
  payableOutstanding: string;
  payableByAccount: Record<string, string>;
  depositOutstanding: string;
  hasBookedPayable: boolean;
  status: string;
}

export interface SupplierPayment {
  id: string;
  kind: SupplierPaymentKind;
  amount: string;
  paidAt: string;
  postedAt: string;
  bankAccountCode: string | null;
  reference: string | null;
  slipUrl: string | null;
  note: string | null;
  receivingId: string | null;
  journalEntryId: string | null;
  journalEntryNo: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: { id: string; name: string } | null;
  voidReason: string | null;
  reversalJournalEntryId: string | null;
  reversalJournalEntryNo: string | null;
}

export interface PoPaymentsResponse {
  summary: SupplierPaymentSummary;
  payments: SupplierPayment[];
  /** ยอดจ่ายที่กรอกไว้ก่อนมีเมนูนี้ (ไม่ได้ลงบัญชี) — แสดงเป็นป้ายเท่านั้น */
  legacyPaidAmount: string;
}

export interface RecordSupplierPaymentPayload {
  paidAt: string;
  amount: number;
  slipUrl: string;
  reference?: string;
  note?: string;
  /** uuid ต่อการเปิดหน้าต่าง — กดซ้ำ/เน็ตส่งซ้ำ API ตอบรายการเดิม */
  requestId?: string;
}

export interface CancelPOPayload {
  depositOutcome?: 'REFUNDED' | 'FORFEITED';
  refundedAt?: string;
  refundAmount?: number;
  slipUrl?: string;
  reason?: string;
}

// ───────────── เจ้าหนี้รายผู้จัดจำหน่ายจากสมุดบัญชี — `GET /purchase-orders/payables/ledger` ─────────────

export interface SupplierLedgerOpenPo {
  id: string;
  poNumber: string;
  netAmount: string;
  paidAmount: string;
  remaining: string;
  dueDate: string | null;
  status: string;
  paymentStatus: string;
}

export interface SupplierLedgerRow {
  supplier: { id: string; name: string; hasVat: boolean };
  opening: string;
  receipts: string;
  payments: string;
  closing: string;
  payableByAccount: Record<string, string>;
  depositsOutstanding: string;
  openPoCount: number;
  nextDue: string | null;
  dueState: 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NONE';
  openPos: SupplierLedgerOpenPo[];
}

export interface SupplierLedgerResponse {
  month: string;
  periodStart: string;
  periodEnd: string;
  totals: { closing: string; depositsOutstanding: string; dueWithin7Days: string; overdue: string; supplierCount: number; openPoCount: number };
  suppliers: SupplierLedgerRow[];
}

export interface SupplierLedgerMovementRow {
  journalEntryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  kind: string;
  poNumber: string | null;
  grNumber: string | null;
  paymentId: string | null;
  payableIncrease: string;
  payableDecrease: string;
  depositChange: string;
  running: string;
}

export interface SupplierLedgerMovements {
  supplier: { id: string; name: string; hasVat: boolean };
  month: string;
  opening: string;
  closing: string;
  rows: SupplierLedgerMovementRow[];
}

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
export interface ApprovePOPayload {
  id: string;
  expectedDate?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paidAmount?: number;
  paymentNotes?: string;
  attachments?: string[];
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

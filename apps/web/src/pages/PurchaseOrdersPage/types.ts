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

export interface ReceivingUnitForm {
  poItemId: string;
  label: string;
  category: string;
  imeiSerial: string;
  serialNumber: string;
  status: 'PASS' | 'REJECT';
  rejectReason: string;
  defectReason: DefectReasonValue | '';
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  checklist: { item: string; category: string; passed: boolean; note: string }[];
  sellingPrice: string;
  photos: string[];
  costPrice: string; // direct-receive only (empty for PO-based receive)
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

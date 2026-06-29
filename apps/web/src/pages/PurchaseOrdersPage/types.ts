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

// One ad-hoc supplier-direct line (expands into `quantity` ReceivingUnitForm units)
export interface DirectReceiveLineForm {
  category: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  accessoryType: string;
  accessoryBrand: string;
  quantity: string;
  costPrice: string;
}

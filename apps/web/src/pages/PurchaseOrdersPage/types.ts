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
  dueDate: string | null;
  status: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  discount: string;
  netAmount: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paidAmount: string;
  paymentNotes: string | null;
  attachments: string[];
  notes: string | null;
  supplier: { id: string; name: string; contactName: string; phone: string; hasVat: boolean };
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

export interface ReceivingUnitForm {
  poItemId: string;
  label: string;
  category: string;
  imeiSerial: string;
  serialNumber: string;
  status: 'PASS' | 'REJECT';
  rejectReason: string;
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  checklist: { item: string; category: string; passed: boolean; note: string }[];
  sellingPrice: string;
}

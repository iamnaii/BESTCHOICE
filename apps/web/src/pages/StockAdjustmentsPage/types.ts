/** ก้อน 3 — คำขอตัดสินค้า (2026-10-05): ชนิดข้อมูลตรงกับ API `/stock-adjustments` */
export type AdjustmentReason = 'DAMAGED' | 'LOST' | 'WRITE_OFF' | 'FOUND' | 'CORRECTION' | 'OTHER';
export type AdjustmentStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELED';

export interface NamedUser {
  id: string;
  name: string;
}

export interface StockAdjustmentRow {
  id: string;
  requestNumber: string | null;
  reason: AdjustmentReason;
  status: AdjustmentStatus;
  previousStatus: string;
  notes: string | null;
  photos: string[];
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  canceledAt: string | null;
  costAmount: string | null;
  inventoryAccountCode: string | null;
  inventoryBooked: boolean | null;
  bookedSource: string | null;
  journalEntryId: string | null;
  journalEntryNo: string | null;
  product: {
    id: string;
    name: string;
    brand: string;
    model: string;
    color?: string | null;
    storage?: string | null;
    imeiSerial: string | null;
    serialNumber?: string | null;
    costPrice: string;
    category: string;
    status: string;
    deletedAt: string | null;
  };
  branch: { id: string; name: string };
  adjustedBy: NamedUser;
  approvedBy?: NamedUser | null;
  rejectedBy?: NamedUser | null;
  canceledBy?: NamedUser | null;
}

export interface BookedInventory {
  booked: boolean;
  source: string | null;
  bookedAmount: string | null;
  journalEntryNo: string | null;
  grNumber: string | null;
}

export interface AdjustmentDetail extends StockAdjustmentRow {
  photoUrls: string[];
  booked: BookedInventory | null;
}

export interface AdjustmentJournalLine {
  accountCode: string;
  name: string;
  debit: string;
  credit: string;
}

export interface AdjustmentPreview {
  productStatusAfter: string | null;
  holdsProduct: boolean;
  costAmount: string | null;
  inventoryAccountCode: string | null;
  booked: BookedInventory;
  journalLines: AdjustmentJournalLine[];
  journalNote: string;
  requiresPhoto: boolean;
}

export interface ProductLookupRow {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  status: string;
  deletedAt: string | null;
  branch: { id: string; name: string };
  costPrice: string;
  category: string;
  pendingRequestNumber: string | null;
}

export interface AdjustmentListResponse {
  data: StockAdjustmentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApproveResponse {
  adjustment: StockAdjustmentRow;
  journalEntryNo: string | null;
  inventoryBooked: boolean | null;
  productStatus: string;
  accountingNotified: boolean;
}

export interface AdjustmentListFilters {
  status?: AdjustmentStatus | '';
  reason?: AdjustmentReason | '';
  branchId?: string;
  productId?: string;
  search?: string;
  mine?: boolean;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface CurrentActor {
  id: string;
  role: string;
  branchId?: string | null;
}

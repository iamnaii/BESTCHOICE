export type BookingStatus = 'PENDING_DEPOSIT' | 'PAID' | 'CANCELED' | 'EXPIRED' | 'CONVERTED';

/** สถานะเครื่องปัจจุบันที่ API แปะมากับรายการ (เช็คสดในแผง) */
export interface BookingProductRef {
  id: string;
  name: string;
  status: string;
  branchId: string;
  imeiSerial?: string | null;
  wasPreviouslyDamaged?: boolean;
}

export interface BookingItem {
  id: string;
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: string | number;
  amount: string | number;
  product?: BookingProductRef | null;
}

/** จาก AuditLog ของใบ (GET /bookings/:id → events[]) */
export interface BookingEvent {
  id: string;
  kind: string;
  at: string;
  actor: { id: string; name: string } | null;
  data: Record<string, unknown> | null;
}

export interface Booking {
  id: string;
  bookingNumber: string;
  status: BookingStatus;
  depositAmount: string | number;
  totalAmount: string | number;
  expireDate: string;
  notes?: string | null;
  depositPaidAt?: string | null;
  depositMethod?: string | null;
  canceledAt?: string | null;
  cancelReason?: string | null;
  convertedAt?: string | null;
  /** PR 2 — เครื่องที่ใบนี้ล็อกไว้ตอนรับมัดจำ (ล้างเมื่อยกเลิก/หมดอายุ/ขาย) */
  lockedProductId?: string | null;
  lockedAt?: string | null;
  unlockedAt?: string | null;
  customer: { id: string; name: string; phone?: string | null };
  branch: { id: string; name: string; shopCashAccountCode?: string | null };
  createdBy: { id: string; name: string };
  canceledBy?: { id: string; name: string } | null;
  convertedToSale?: { id: string; saleNumber: string } | null;
  items: BookingItem[];
  createdAt: string;
  events?: BookingEvent[];
}

export interface BookingListResponse {
  data: Booking[];
  total: number;
  page: number;
  limit: number;
}

export interface BookingSummary {
  total: number;
  open: number;
  pendingDeposit: number;
  paid: number;
  paidDepositHeld: string;
  expiringWithin3Days: number;
  closed: { converted: number; canceled: number; expired: number; total: number };
  forfeitedThisMonth: string;
}

export interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
  chatPlaceholder?: boolean;
}

export interface BranchOption {
  id: string;
  name: string;
}

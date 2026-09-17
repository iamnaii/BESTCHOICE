import type {
  ChatLogo,
  CustomerInstallmentState,
  CustomerPurchasedWithin,
  CustomerPurchaseKind,
  CustomerView,
  ProspectContactedWithin,
  ProspectSource,
} from '@installment/shared';
import type { CustomerTagType } from '@/pages/CollectionsPage/hooks/useCustomerTags';
import type { CustomerTier } from '@/types/customer-tier';

export type {
  ChatLogo,
  CustomerInstallmentState,
  CustomerPurchaseKind,
  CustomerPurchasedWithin,
  CustomerView,
  ProspectContactedWithin,
  ProspectSource,
};

/** ห้องแชทที่ผูกกับคนนี้ — หนึ่งแถวต่อโลโก้ (LINE_FINANCE + LINE_SHOP ยุบเป็น LINE แล้วที่ API) */
export interface CustomerChatRoom {
  roomId: string;
  logo: ChatLogo;
  channel: string;
}

/** ชิป "การซื้อ" — ถังตาม ContractStatus ที่ API จัดมาให้แล้ว */
export interface CustomerPurchaseSummary {
  installmentTotal: number;
  installmentByState: Record<'ACTIVE' | 'OVERDUE' | 'CLOSED' | 'BAD_DEBT' | 'OTHER', number>;
  cashCount: number;
  externalFinanceCount: number;
}

export interface CustomerLatestPurchase {
  at: string;
  kind: 'INSTALLMENT' | 'CASH' | 'EXTERNAL_FINANCE';
  number: string;
  productLabel: string;
  imeiSerial: string | null;
  branchId: string | null;
  branchName: string | null;
}

export interface CustomerWarranty {
  endDate: string | null;
  source: 'SHOP' | 'CENTER' | null;
  shopEndDate: string | null;
  centerEndDate: string | null;
  status:
    | 'IN_7DAY_DEFECT'
    | 'IN_SHOP_WARRANTY'
    | 'IN_MANUFACTURER'
    | 'OUT_OF_WARRANTY'
    | 'WALK_IN';
}

export interface CustomerInstallmentBalance {
  outstanding: number;
  nextDueDate: string | null;
  nextAmountDue: number | null;
  openContracts: number;
}

/** แท็บ "ลูกค้า" — PLAN §1.2 */
export interface CustomerRow {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  /** `Customer.nationalId` เป็น nullable — ผู้สนใจจากแชท/ลูกค้าที่ยังไม่เคยให้บัตร */
  nationalId: string | null;
  occupation: string | null;
  salary: number | string | null;
  createdAt: string;
  _count: { contracts: number };
  activeContracts: number;
  overdueContracts: number;
  latestCreditStatus: string | null;
  latestCreditScore: number | null;
  tier?: CustomerTier;
  lineIdFinance?: string | null;
  lineIdShop?: string | null;
  purchase?: CustomerPurchaseSummary;
  latestPurchase?: CustomerLatestPurchase | null;
  warranty?: CustomerWarranty | null;
  installmentBalance?: CustomerInstallmentBalance | null;
  chatRooms?: CustomerChatRoom[];
  /** ผู้สนใจอัตโนมัติจากแชท (API ตัดสินให้) — แท็บลูกค้าไม่มี แต่ตัวเลือกลูกค้า (ไม่ส่ง view) ได้แถวเดียวกัน */
  chatPlaceholder?: boolean;
  source?: ProspectSource | null;
  acquisitionSourceRaw?: string | null;
}

/** แท็บ "ผู้สนใจ" — PLAN §1.3 (ไม่มี tier / purchase / contracts เลยโดยนิยาม) */
export interface ProspectRow {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  nationalId: string | null;
  createdAt: string;
  source: ProspectSource | null;
  acquisitionSourceRaw: string | null;
  tags: { tag: CustomerTagType }[];
  creditCheckStatus: string;
  latestCreditScore: number | null;
  lastContactAt: string | null;
  lastContactSource: 'CUSTOMER' | 'ROOM' | null;
  assignedTo: { id: string; name: string } | null;
  chatRooms?: CustomerChatRoom[];
  chatPlaceholder?: boolean;
}

export interface CustomerTabSummary {
  total: number;
  installment: number;
  cash: number;
  externalFinance: number;
  overdue: number;
  fromChat: number;
}

export interface ProspectTabSummary {
  total: number;
  contacted7d: number;
  checkingCredit: number;
  prechecked: number;
  silent30d: number;
}

export interface CustomerViewCounts {
  customers: number;
  prospects: number;
}

/** ซองตอบกลับหลังจาก axios interceptor ปอกชั้นนอกไปแล้วหนึ่งชั้น (PLAN §1.1) */
export interface CustomersResponse<TRow, TSummary> {
  data: TRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary?: TSummary;
  viewCounts?: CustomerViewCounts;
}

export type CustomerListResponse = CustomersResponse<CustomerRow, CustomerTabSummary>;
export type ProspectListResponse = CustomersResponse<ProspectRow, ProspectTabSummary>;

/** แถวอะไรก็ได้ที่ตารางรับได้ */
export type AnyCustomerRow = CustomerRow | ProspectRow;

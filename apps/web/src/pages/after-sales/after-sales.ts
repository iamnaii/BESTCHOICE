import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
export {
  baht,
  timeOf,
  dayOf,
  dayTimeOf,
  daysSince,
  thaiShortDate,
} from '../shop-daily-cash/cash-close';
export type AfterSalesStage =
  | 'RECEIVED'
  | 'IN_REPAIR'
  | 'AWAITING_APPROVAL'
  | 'READY_FOR_PICKUP'
  | 'CLOSED'
  | 'CANCELLED';
export type AfterSalesOutcome =
  | 'REPAIR'
  | 'SAME_MODEL_EXCHANGE'
  | 'PRICED_EXCHANGE'
  | 'CASH_SAME_MODEL_EXCHANGE';
export type AfterSalesSource = 'INSTALLMENT_CONTRACT' | 'CASH_SALE' | 'WALK_IN';
export type Payer = 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
export interface OutcomeOption {
  outcome: AfterSalesOutcome;
  enabled: boolean;
  implemented: boolean;
  reason?: string;
  note?: string;
  payerDefault?: Payer;
}
export interface LookupResult {
  found: boolean;
  source: AfterSalesSource;
  product: {
    id: string;
    brand: string;
    model: string;
    storage?: string | null;
    imeiSerial: string | null;
  } | null;
  customer: { id: string; name: string; phone: string | null } | null;
  contract: { id: string; contractNumber: string; status: string } | null;
  sale: { id: string; saleType: string } | null;
  warranty: {
    status: string;
    daysRemainingIn7Day: number;
    purchasedAt: string | null;
    shopWarrantyEndDate: string | null;
    manufacturerWarrantyEndDate: string | null;
    checkedAt: string;
  };
  purchasePhotos: Record<
    'front' | 'back' | 'left' | 'right' | 'top' | 'bottom',
    string | null
  > | null;
  openCase: { id: string; caseNumber: string; stage: AfterSalesStage } | null;
  outcomes: OutcomeOption[];
}
export interface CaseRow {
  id: string;
  caseNumber: string;
  source: AfterSalesSource;
  outcome: AfterSalesOutcome | null;
  stage: AfterSalesStage;
  stale: boolean;
  daysInStage: number;
  receivedAt: string;
  deviceBrand: string | null;
  deviceModel: string | null;
  deviceImei: string | null;
  customer: { id: string; name: string; phone: string | null };
  branch: { id: string; name: string };
  receivedBy: { id: string; name: string };
  repairTicket: {
    id: string;
    ticketNumber: string;
    status: string;
    payer: Payer;
    estimatedCost: string | null;
    actualCost: string | null;
    sentToRepairAt: string | null;
    repairedAt: string | null;
  } | null;
}
export interface Summary {
  open: number;
  openRepair: number;
  openExchange: number;
  stale: number;
  awaitingApproval: number;
  repairCostShop: number | null;
  repairCostCustomer: number | null;
  supplierClaims: number;
  exchanges: number;
}
export interface ListResponse {
  data: CaseRow[];
  total: number;
  page: number;
  limit: number;
  truncated: boolean;
  summary?: Summary;
}
export interface TimelineItem {
  at: string;
  kind: string;
  note: string | null;
  actorName?: string;
}
export interface CaseDetail extends CaseRow {
  symptom: string;
  accessories: { box?: boolean; charger?: boolean; case?: boolean; other?: string };
  unlockConfirmed: boolean;
  warrantySnapshot: {
    status: string;
    daysRemainingIn7Day: number;
    shopWarrantyEndDate: string | null;
    manufacturerWarrantyEndDate: string | null;
    checkedAt: string;
  };
  photoCount: number;
  purchasePhotoAngles: string[];
  lineLinked: boolean;
  timeline: TimelineItem[];
  cancelReason: string | null;
  closedAt: string | null;
  contractId: string | null;
  saleId: string | null;
  repairTicket:
    | (CaseRow['repairTicket'] & {
        externalClaimNo: string | null;
        repairSupplier: { id: string; name: string } | null;
        expenseDocument: { id: string; number: string } | null;
        otherIncome: { id: string; docNumber: string } | null;
      })
    | null;
}

export const STAGE_LABEL: Record<AfterSalesStage, string> = {
  RECEIVED: 'รับเรื่องแล้ว',
  IN_REPAIR: 'กำลังซ่อม',
  AWAITING_APPROVAL: 'รออนุมัติ',
  READY_FOR_PICKUP: 'รอลูกค้ารับ',
  CLOSED: 'ปิดเคส',
  CANCELLED: 'ยกเลิก',
};
export const STAGE_ICON: Record<AfterSalesStage, LucideIcon> = {
  RECEIVED: Inbox,
  IN_REPAIR: Wrench,
  AWAITING_APPROVAL: Clock,
  READY_FOR_PICKUP: CheckCircle2,
  CLOSED: CheckCircle2,
  CANCELLED: XCircle,
};
/** โทเคนเท่านั้น — ตัวอักษรเหลือง = text-warning-strong (frontend.md) */
export const STAGE_TILE: Record<AfterSalesStage, string> = {
  RECEIVED: 'border-border bg-muted text-foreground',
  IN_REPAIR: 'border-warning/40 bg-warning/10 text-warning-strong',
  AWAITING_APPROVAL: 'border-warning/40 bg-warning/10 text-warning-strong',
  READY_FOR_PICKUP: 'border-primary/20 bg-primary/10 text-primary',
  CLOSED: 'border-primary/20 bg-primary/10 text-primary',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
};
export const STALE_ICON = AlertTriangle;
export const SOURCE_LABEL: Record<AfterSalesSource, string> = {
  INSTALLMENT_CONTRACT: 'สัญญาผ่อน',
  CASH_SALE: 'ขายสด / ไฟแนนซ์นอก',
  WALK_IN: 'ไม่ได้ซื้อจากร้าน',
};
export const OUTCOME_LABEL: Record<AfterSalesOutcome, string> = {
  REPAIR: 'ซ่อม',
  SAME_MODEL_EXCHANGE: 'เปลี่ยนรุ่นเดิม',
  PRICED_EXCHANGE: 'เปลี่ยนแบบมีราคา',
  CASH_SAME_MODEL_EXCHANGE: 'เปลี่ยนรุ่นเดิม (ขายสด)',
};
export const PAYER_LABEL: Record<Payer, string> = {
  SHOP: 'ร้านจ่าย',
  CUSTOMER: 'ลูกค้าจ่าย',
  SUPPLIER_CLAIM: 'เคลมศูนย์',
};
export const WARRANTY_LABEL: Record<string, string> = {
  IN_7DAY_DEFECT: 'อยู่ในกรอบ 7 วัน',
  IN_SHOP_WARRANTY: 'ในประกันร้าน',
  IN_MANUFACTURER: 'ในประกันศูนย์',
  OUT_OF_WARRANTY: 'หมดประกัน',
  WALK_IN: 'ไม่ได้ซื้อจากร้าน',
};
const STALE_DAYS: Partial<Record<AfterSalesStage, [number, string]>> = {
  IN_REPAIR: [14, 'ส่งศูนย์'],
  READY_FOR_PICKUP: [7, 'รอรับ'],
  AWAITING_APPROVAL: [2, 'รออนุมัติ'],
};
export function staleLabel(stage: AfterSalesStage, days: number): string | null {
  const s = STALE_DAYS[stage];
  return s && days > s[0] ? `${s[1]} ${days} วัน (เกิน ${s[0]})` : null;
}
export const afterSalesKeys = {
  all: ['after-sales'] as const,
  list: (p: Record<string, unknown>) => ['after-sales', 'list', p] as const,
  case: (id: string) => ['after-sales', 'case', id] as const,
  lookup: (imei: string) => ['after-sales', 'lookup', imei] as const,
};

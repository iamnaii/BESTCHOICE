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
export type ExchangeKind = 'SAME_MODEL' | 'PRICED';
export type ExchangeApproverRole = 'BRANCH_MANAGER' | 'OWNER';
export type ExchangeApprovalTier = 'AUTO' | 'REVIEW' | 'ESCALATE';

/** Task 7 (query.service) shape — เหมือนกันทั้ง list (`CaseRow`) และเคสเดี่ยว (`CaseDetail`) */
export interface CaseExchangeInfo {
  kind: ExchangeKind;
  mode: 'MEMO' | 'PRICED' | null;
  approvalTier: ExchangeApprovalTier | null;
  requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED' | null;
  buybackPrice: string | null;
  ncvSnapshot: string | null;
  approverRole: ExchangeApproverRole;
  oldProduct: {
    brand: string;
    model: string;
    storage: string | null;
    imeiSerial: string | null;
  } | null;
  newProduct: {
    id: string;
    brand: string;
    model: string;
    storage: string | null;
    imeiSerial: string | null;
  } | null;
  replacementContract: { id: string; contractNumber: string; status: string } | null;
  requestedBy: { id: string; name: string } | null;
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
  exchange: CaseExchangeInfo | null;
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
  replacementProductId: string | null;
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
export const EXCHANGE_KIND_LABEL: Record<ExchangeKind, string> = {
  SAME_MODEL: 'รุ่นเดิม · 7 วัน',
  PRICED: 'มีราคา',
};
export const APPROVER_LABEL: Record<ExchangeApproverRole, string> = {
  BRANCH_MANAGER: 'ผจก.สาขา',
  OWNER: 'เจ้าของเท่านั้น',
};
export const TIER_LABEL: Record<ExchangeApprovalTier, string> = {
  AUTO: 'อัตโนมัติ',
  REVIEW: 'REVIEW',
  ESCALATE: 'ESCALATE',
};
/** หัวข้อ StepBar 4 ขั้นต่อ outcome (Task 11 ใช้ประกอบ StepBar — ห้ามมีเลขนำหน้า/คำว่า "รับเครื่อง") */
export const STEP_TITLES_BY_OUTCOME: Record<AfterSalesOutcome, [string, string, string, string]> = {
  REPAIR: ['รับเรื่องแล้ว', 'กำลังซ่อม', 'รอลูกค้ารับ', 'ปิดเคส'],
  SAME_MODEL_EXCHANGE: ['รับเรื่องแล้ว', 'รอ ผจก. ยืนยัน', 'ส่งมอบเครื่องใหม่', 'ปิดเคส'],
  CASH_SAME_MODEL_EXCHANGE: ['รับเรื่องแล้ว', 'รอ ผจก. ยืนยัน', 'ส่งมอบเครื่องใหม่', 'ปิดเคส'],
  PRICED_EXCHANGE: ['รับเรื่องแล้ว', 'รออนุมัติ', 'สัญญาใหม่', 'ปิดเคส'],
};
/** ตำแหน่งขั้นบน StepBar (0..3) — เหมือนกันทุก outcome เพราะ index อ้างอิงตำแหน่งไม่ใช่ป้าย
 * (ป้ายต่างกันตาม STEP_TITLES_BY_OUTCOME) · CANCELLED = ไม่มีขั้นไหน "now"/"done" เลย (idle ทั้งหมด
 * — ตรงกับที่ AfterSalesCasePage ใช้ stepIndex===-1 ตัดสิน tone อยู่แล้ว) */
export function stageIndex(stage: AfterSalesStage): number {
  switch (stage) {
    case 'RECEIVED':
      return 0;
    case 'IN_REPAIR':
    case 'AWAITING_APPROVAL':
      return 1;
    case 'READY_FOR_PICKUP':
      return 2;
    case 'CLOSED':
      return 3;
    case 'CANCELLED':
    default:
      return -1;
  }
}
export type WarrantyStatus =
  | 'IN_7DAY_DEFECT'
  | 'IN_SHOP_WARRANTY'
  | 'IN_MANUFACTURER'
  | 'OUT_OF_WARRANTY'
  | 'WALK_IN';
/** รายการ WarrantyStatus ทั้งหมด — ใช้ทดสอบว่า WARRANTY_LABEL/WARRANTY_TILE มีครบทุกค่า */
export const WARRANTY_STATUSES: WarrantyStatus[] = [
  'IN_7DAY_DEFECT',
  'IN_SHOP_WARRANTY',
  'IN_MANUFACTURER',
  'OUT_OF_WARRANTY',
  'WALK_IN',
];
// Record<string, string> (ไม่ใช่ Record<WarrantyStatus, string>) เพราะ LookupResult['warranty']['status']
// มาจาก API เป็น string ทั่วไป — indexing ด้วย WarrantyStatus ที่แคบกว่าจะพัง TS ที่ทุกจุดเรียกใช้
// (`WARRANTY_LABEL[result.warranty.status]`). ความครบถ้วนของทั้งสองแมพตรวจด้วยเทสต์แทน (ดู
// after-sales.test.ts + WARRANTY_STATUSES ด้านบน)
export const WARRANTY_LABEL: Record<string, string> = {
  IN_7DAY_DEFECT: 'อยู่ในกรอบ 7 วัน',
  IN_SHOP_WARRANTY: 'ในประกันร้าน',
  IN_MANUFACTURER: 'ในประกันศูนย์',
  OUT_OF_WARRANTY: 'หมดประกัน',
  WALK_IN: 'ไม่ได้ซื้อจากร้าน',
};
/** ป้ายสถานะประกัน (โทเคนเท่านั้น) — ใช้ร่วมกันทั้ง IntakeBox และ AfterSalesNewPage
 * (ไม่ยืมสี STAGE_TILE ตรงๆ เพราะประกันไม่ใช่ขั้นตอนของเคส — คงกฎ "ห้ามบอกสถานะด้วยสีอย่างเดียว"
 * ด้วยข้อความในป้ายเอง) */
export const WARRANTY_TILE: Record<string, string> = {
  IN_7DAY_DEFECT: 'border-warning/40 bg-warning/10 text-warning-strong',
  IN_SHOP_WARRANTY: 'border-primary/20 bg-primary/10 text-primary',
  IN_MANUFACTURER: 'border-primary/20 bg-primary/10 text-primary',
  OUT_OF_WARRANTY: 'border-border bg-muted text-muted-foreground',
  WALK_IN: 'border-border bg-muted text-muted-foreground',
};
const STALE_DAYS: Partial<Record<AfterSalesStage, [number, string]>> = {
  IN_REPAIR: [14, 'ส่งศูนย์'],
  READY_FOR_PICKUP: [7, 'รอรับ'],
  AWAITING_APPROVAL: [2, 'รออนุมัติ'],
};
export function staleLabel(stage: AfterSalesStage, days: number): string | null {
  const s = STALE_DAYS[stage];
  // C3 (final-fix brief) — API `isStale` เทียบเป็นมิลลิวินาที (`ms > d*86400000`) แต่ `days`
  // ที่ได้ตรงนี้คือ `Math.floor(ms/86400000)` — เมื่อ API บอกว่า stale จริง `floor(ms/day)`
  // จะ >= d เสมอ (ไม่ใช่ > d เท่านั้น — เคส 14.5 วันจริง floor เหลือ 14 พอดี) ใช้ `>=` ให้
  // boundary ตรงกับ semantics ของ API แทนที่จะพลาดขอบวันสุดท้ายก่อนขึ้นวันถัดไป
  // R25 (e) — เลิกคำว่า "เกิน" ที่ขอบ (อ่านเหมือนเลยเส้นตายไปแล้วเสมอ แม้ค่าเพิ่งแตะเกณฑ์พอดี)
  return s && days >= s[0] ? `${s[1]} ${days} วัน (เกณฑ์ ${s[0]} วัน)` : null;
}
export const afterSalesKeys = {
  all: ['after-sales'] as const,
  list: (p: Record<string, unknown>) => ['after-sales', 'list', p] as const,
  case: (id: string) => ['after-sales', 'case', id] as const,
  lookup: (imei: string) => ['after-sales', 'lookup', imei] as const,
  preview: (p: Record<string, unknown>) => ['after-sales', 'preview', p] as const,
  replacementProducts: (p: Record<string, unknown>) =>
    ['after-sales', 'replacement-products', p] as const,
};

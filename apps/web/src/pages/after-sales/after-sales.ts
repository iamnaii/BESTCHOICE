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
  /** Task 8 — ลูกค้าที่พบ (found=true) ผูก LINE ไว้กับร้านหรือไม่ (จาก LookupResult.lineLinked ฝั่ง
   * API, Task 3) ใช้ต่อบรรทัด "จะส่ง LINE" ในสรุปก่อนบันทึกของ AfterSalesNewPage */
  lineLinked: boolean;
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
  /** Task 8 — ประวัติเหตุการณ์ LINE ของเคสนี้ (getCase().lineEvents ฝั่ง API) เรียงใหม่สุดก่อน
   * สูงสุด 5 แถว ใช้เติมการ์ด "LINE ลูกค้า" บน AfterSalesCasePage */
  lineEvents: { at: string; kind: 'LINE_SENT' | 'LINE_SKIPPED_NO_LINK' | 'NOTE'; note: string }[];
  timeline: TimelineItem[];
  cancelReason: string | null;
  closedAt: string | null;
  contractId: string | null;
  saleId: string | null;
  replacementProductId: string | null;
  /** Task 11 — `AfterSalesCase.replacementContractId` เป็นสกาลาร์จริงบนโมเดล (confirmSameModel
   * เขียนตอนยืนยัน) และเดินทางมาถึง response จริงผ่าน `{...row}` ของ `decorate()`/`getCase()`
   * (`include` ไม่ตัดสกาลาร์ทิ้ง) แม้ Task 9 จะไม่ได้ประกาศไว้ในทีแรก — เพิ่มที่นี่ให้ตรงกับ API จริง */
  replacementContractId: string | null;
  /** final fix wave — สกาลาร์จริงบนโมเดล (เดินทางมาถึง response ผ่าน `{...row}` เหมือน
   * replacementContractId) ใช้ตัดสินว่าเคสเปลี่ยนเครื่องมีอะไรฝั่ง engine หรือยัง (M1/I2) */
  repairTicketId: string | null;
  exchangeRequestId: string | null;
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

/**
 * Task 8 — ตัด tag `[XXX]` นำหน้า note ของ AfterSalesEvent LINE ออกก่อนแสดงผล (การ์ด "LINE
 * ลูกค้า" + แถวไทม์ไลน์) — ฝั่ง API (`lineEventNote()` ใน after-sales-line-copy.util.ts) เขียน
 * note เป็น `[<eventType>] <ป้ายจังหวะ> · <สถานะ>` เสมอ; ตัด tag ออกแล้วเหลือ
 * "<ป้ายจังหวะ> · <สถานะ>" ที่พนักงานอ่านแล้วเข้าใจได้เลย ไม่ต้องรู้จักชื่อ event type ภายใน
 */
export function stripLineTag(note: string): string {
  return note.replace(/^\[[^\]]*\]\s*/, '');
}

/** Task 11 — dialog vocabulary ที่ page/ExchangeActionDialogs ใช้ร่วมกัน (แหล่งเดียว ห้ามมีสำเนา) */
export type CaseDialogId =
  | 'send'
  | 'mark-repaired'
  | 'send-back'
  | 'cancel'
  | 'return'
  | 'exchange-confirm'
  | 'exchange-deliver'
  | 'exchange-reject'
  | 'switch-to-repair'
  | 'approve'
  | 'reject-priced'
  | 'cancel-swap';

/** I4 (final fix wave) — ปุ่มหลักมีสามรูปแบบ: เปิด dialog · ลิงก์ไปหน้าอื่น (ขั้นถัดไปอยู่นอกหน้านี้ เช่น
 * เปิดใช้สัญญาใหม่ที่หน้าสัญญา) · ข้อความรอ (role ทำขั้นนี้ไม่ได้) */
export type PrimaryAction =
  | { label: string; dialog: CaseDialogId }
  | { label: string; href: string }
  | { waitingText: string };

export type SecondaryAction =
  | { kind: 'dialog'; label: string; dialog: CaseDialogId; destructive?: boolean }
  | { kind: 'link'; label: string; to: string };

const STAFF_SET = new Set(['OWNER', 'BRANCH_MANAGER', 'SALES']);
const MGR_SET = new Set(['OWNER', 'BRANCH_MANAGER']);
/** role ที่เปิดใช้สัญญา (DRAFT → ACTIVE) ที่หน้าสัญญาได้ */
const CONTRACT_ACTIVATOR_SET = new Set(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']);

/**
 * I4 — สัญญาใหม่ของทางออกเปลี่ยนเครื่องที่ READY_FOR_PICKUP: SAME_MODEL (รวมที่มาจากใบซ่อม — outcome
 * กลายเป็น SAME_MODEL หลังยืนยัน) อ่านจาก `replacementContractId` + `exchange.replacementContract`
 * ส่วน PRICED อ่านจาก `exchange.replacementContract` (คำขอ → newContract; เคสไม่ได้เก็บ
 * replacementContractId เอง). ใช้ทางเดียวกันทั้งสอง outcome
 */
function readyReplacementContract(
  data: CaseDetail,
): { id: string; contractNumber: string; status: string } | null {
  if (data.stage !== 'READY_FOR_PICKUP') return null;
  if (data.outcome === 'SAME_MODEL_EXCHANGE' && data.replacementContractId) {
    return data.exchange?.replacementContract ?? null;
  }
  if (data.outcome === 'PRICED_EXCHANGE') return data.exchange?.replacementContract ?? null;
  return null;
}

/** I4 — สัญญาใหม่ยัง DRAFT: ขั้นที่ทำได้จริงถัดไปคือเปิดใช้ที่หน้าสัญญา (ส่งมอบก่อนไม่ได้ — API 400) */
function activateContractStep(
  contract: { id: string; contractNumber: string },
  role: string,
): PrimaryAction {
  if (CONTRACT_ACTIVATOR_SET.has(role)) {
    return {
      label: `เปิดใช้สัญญาใหม่ ${contract.contractNumber} ที่หน้าสัญญา`,
      href: `/contracts/${contract.id}`,
    };
  }
  return { waitingText: `รอเปิดใช้สัญญาใหม่ ${contract.contractNumber}` };
}

/**
 * Task 11 — ปุ่มหลักปุ่มเดียวตาม outcome × stage × role (ตารางในบรีฟ) แทน `primaryLabelOf` เดิม.
 * คืน `{label,dialog}` (ปุ่มเปิด dialog) · `{label,href}` (ลิงก์ปุ่มหลัก — I4: สัญญาใหม่ยัง DRAFT →
 * "เปิดใช้สัญญาใหม่ … ที่หน้าสัญญา" สำหรับ OWNER/BM/FM ทั้ง SAME_MODEL และ PRICED) · `{waitingText}`
 * (role ทำขั้นนี้ไม่ได้ — โชว์ข้อความรอแทนปุ่ม: แถวรออนุมัติทุก role ที่ไม่ใช่ผู้อนุมัติ รวม FM/ACCOUNTANT
 * และแถวรอเปิดใช้สัญญาใหม่ทุก role ที่เปิดใช้สัญญาไม่ได้) · หรือ `null` (ไม่มีปุ่ม/ข้อความ — CLOSED/
 * CANCELLED ทุกทาง และแถวงานซ่อม/ส่งมอบที่ role อ่านอย่างเดียวอย่าง FM/ACCOUNTANT ทำไม่ได้).
 */
export function primaryAction(data: CaseDetail, role: string): PrimaryAction | null {
  const { outcome, stage } = data;

  if (stage === 'CLOSED' || stage === 'CANCELLED') return null;

  // แถว "REPAIR/SAME_MODEL | READY_FOR_PICKUP (มี replacementContractId)" — ส่งมอบเครื่องใหม่
  // มาก่อนกิ่ง REPAIR ปกติเสมอ (ใบซ่อมที่ถูกแทนที่ — repairTicket.status 'REPLACED' — ไม่ใช่ REPAIR
  // อีกต่อไปในทางปฏิบัติ เพราะ confirmSameModel เซ็ต outcome เป็น SAME_MODEL_EXCHANGE คู่กันเสมอ)
  if (
    outcome === 'SAME_MODEL_EXCHANGE' &&
    stage === 'READY_FOR_PICKUP' &&
    data.replacementContractId
  ) {
    const contract = readyReplacementContract(data);
    // I4 — สัญญาใหม่ยัง DRAFT → เปิดใช้ที่หน้าสัญญาก่อน (ส่งมอบจะ 400); ยกเลิกแล้ว → ไม่มีปุ่ม
    if (contract?.status === 'DRAFT') return activateContractStep(contract, role);
    if (contract?.status === 'CANCELED') return null;
    if (!STAFF_SET.has(role)) return null;
    return { label: 'ส่งมอบเครื่องใหม่', dialog: 'exchange-deliver' };
  }

  // I4 — PRICED READY_FOR_PICKUP: ทางเดียวกับ SAME_MODEL (สัญญาใหม่ของคำขอยัง DRAFT → ลิงก์เปิดใช้)
  if (outcome === 'PRICED_EXCHANGE' && stage === 'READY_FOR_PICKUP') {
    const contract = readyReplacementContract(data);
    if (contract?.status === 'DRAFT') return activateContractStep(contract, role);
    return null;
  }

  if (outcome === 'REPAIR') {
    if (stage === 'RECEIVED') {
      if (!STAFF_SET.has(role)) return null;
      const hasCenter = !!data.repairTicket?.repairSupplier;
      return hasCenter
        ? { label: 'ส่งซ่อม', dialog: 'send' }
        : { label: 'บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)', dialog: 'mark-repaired' };
    }
    if (stage === 'IN_REPAIR') {
      if (!STAFF_SET.has(role)) return null;
      return { label: 'บันทึกซ่อมเสร็จ', dialog: 'mark-repaired' };
    }
    if (stage === 'READY_FOR_PICKUP' && data.repairTicket?.status !== 'REPLACED') {
      if (!STAFF_SET.has(role)) return null;
      return { label: 'ส่งมอบคืนลูกค้า', dialog: 'return' };
    }
    return null;
  }

  if (outcome === 'SAME_MODEL_EXCHANGE' && stage === 'AWAITING_APPROVAL') {
    // P-M.2 (fix round 1): ทุก role ที่ไม่ใช่ MGR ต้องเห็นข้อความรอ (ไม่ใช่แค่ SALES) —
    // FM/ACCOUNTANT อ่านอย่างเดียวก็ยังต้องเห็นสถานะรออนุมัติของแท็บรออนุมัติได้
    if (MGR_SET.has(role)) return { label: 'ยืนยันเปลี่ยนเครื่อง', dialog: 'exchange-confirm' };
    return { waitingText: `รอ ${APPROVER_LABEL.BRANCH_MANAGER} ยืนยัน` };
  }

  if (outcome === 'PRICED_EXCHANGE' && stage === 'AWAITING_APPROVAL') {
    // P-M.2 (fix round 1): เหมือนกัน — role ใดก็ตามที่ไม่ใช่ผู้อนุมัติของ tier นี้เห็นข้อความรอ
    // residual sweep — เคสที่ผูกคำขอไม่สำเร็จ (ไม่มีคำขอให้อนุมัติ) ไม่มีปุ่ม/ข้อความรอ — ทางออกเดียวคือ
    // "ยกเลิกเคส" (ปุ่มรอง, MGR)
    if (!data.exchange?.requestStatus) return null;
    const approverRole = data.exchange?.approverRole ?? 'OWNER';
    if (role === 'OWNER') return { label: 'อนุมัติ', dialog: 'approve' };
    if (role === 'BRANCH_MANAGER' && approverRole === 'BRANCH_MANAGER') {
      return { label: 'อนุมัติ', dialog: 'approve' };
    }
    return { waitingText: `รอ ${APPROVER_LABEL[approverRole]} อนุมัติ` };
  }

  // CASH_SAME_MODEL_EXCHANGE (ยังไม่เปิดใช้ — engine ปฏิเสธเมื่อไม่มี contractId) ตกมาที่นี่
  return null;
}

/**
 * Task 11 — ปุ่มรองตามตารางเดียวกับ `primaryAction`. คืนอาร์เรย์ว่างเมื่อไม่มีปุ่มรอง (CLOSED/
 * CANCELLED ทุกทาง หรือ role ไม่มีสิทธิ์ทำอะไรเลยในแถวนั้น) — ไม่รวมปุ่ม static ที่ไม่ขึ้นกับ
 * outcome/stage อย่าง "ใบรับฝากเครื่อง" (หน้าเพจ render เอง).
 */
export function secondaryActions(data: CaseDetail, role: string): SecondaryAction[] {
  const out: SecondaryAction[] = [];
  const isStaff = STAFF_SET.has(role);
  const isMgr = MGR_SET.has(role);
  const isOwner = role === 'OWNER';
  const { outcome, stage } = data;

  // I3 — ยกเลิก swap ที่ลงผลแล้ว (MEMO applied / สัญญาใหม่เปิดใช้แล้ว → เคส CLOSED) ตามสิทธิ์เดิม —
  // เฉพาะคำขอที่ยัง APPROVED (engine ยกเลิกได้เฉพาะ APPROVED และตัดสินเรื่องการชำระเงินเอง)
  if (
    stage === 'CLOSED' &&
    outcome === 'PRICED_EXCHANGE' &&
    data.exchange?.requestStatus === 'APPROVED' &&
    isMgr
  ) {
    out.push({ kind: 'dialog', label: 'ยกเลิก swap', dialog: 'cancel-swap', destructive: true });
    return out;
  }

  if (stage === 'CLOSED' || stage === 'CANCELLED') return out;

  // M1/M2 (partial) — เคสเปลี่ยนเครื่องที่ยังไม่มีอะไรฝั่ง engine (ไม่มีใบซ่อม/สัญญาใหม่/คำขอผูก) API
  // ยกเลิกเคสได้ (MGR). หน้าจอโชว์ "ยกเลิกเคส" เฉพาะแถวที่ไม่มีทางออกอื่น — PRICED ที่ผูกคำขอไม่สำเร็จ
  // (SAME_MODEL รอยืนยันมี "ปฏิเสธ (ใส่เหตุผล)" ซึ่งปิดเคสแบบเดียวกันอยู่แล้ว ไม่ซ้ำปุ่มทำลายสองปุ่ม)
  const bareExchange =
    (outcome === 'SAME_MODEL_EXCHANGE' || outcome === 'PRICED_EXCHANGE') &&
    !data.repairTicketId &&
    !data.replacementContractId &&
    !data.exchangeRequestId;

  if (outcome === 'REPAIR') {
    if (stage === 'RECEIVED') {
      const hasCenter = !!data.repairTicket?.repairSupplier;
      if (!hasCenter && isStaff) out.push({ kind: 'dialog', label: 'ส่งซ่อม', dialog: 'send' });
      if (isMgr && data.contractId) {
        out.push({
          kind: 'dialog',
          label: 'ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม',
          dialog: 'exchange-confirm',
        });
      }
      if (isMgr)
        out.push({ kind: 'dialog', label: 'ยกเลิกเคส', dialog: 'cancel', destructive: true });
    } else if (stage === 'IN_REPAIR') {
      if (isMgr && data.contractId) {
        out.push({
          kind: 'dialog',
          label: 'ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม',
          dialog: 'exchange-confirm',
        });
      }
    } else if (stage === 'READY_FOR_PICKUP' && data.repairTicket?.status !== 'REPLACED') {
      if (isStaff) out.push({ kind: 'dialog', label: 'ส่งซ่อมต่อ', dialog: 'send-back' });
      if (isMgr)
        out.push({ kind: 'dialog', label: 'ยกเลิกเคส', dialog: 'cancel', destructive: true });
    }
    return out;
  }

  if (outcome === 'SAME_MODEL_EXCHANGE') {
    if (stage === 'AWAITING_APPROVAL') {
      if (isMgr) {
        out.push({
          kind: 'dialog',
          label: 'ปฏิเสธ (ใส่เหตุผล)',
          dialog: 'exchange-reject',
          destructive: true,
        });
      }
      if (isStaff) {
        out.push({ kind: 'dialog', label: "เปลี่ยนเป็น 'ซ่อม' แทน", dialog: 'switch-to-repair' });
      }
    } else if (
      stage === 'READY_FOR_PICKUP' &&
      data.replacementContractId &&
      data.exchange?.replacementContract &&
      // residual sweep — สัญญายัง DRAFT ปุ่มหลักเป็นลิงก์ไปหน้าเดียวกันอยู่แล้ว ไม่ซ้ำลิงก์รอง
      data.exchange.replacementContract.status !== 'DRAFT'
    ) {
      out.push({
        kind: 'link',
        label: `สัญญาใหม่ ${data.exchange.replacementContract.contractNumber}`,
        to: `/contracts/${data.exchange.replacementContract.id}`,
      });
    }
    return out;
  }

  if (outcome === 'PRICED_EXCHANGE') {
    if (stage === 'AWAITING_APPROVAL') {
      // I2 — ไม่มี "ยกเลิกคำขอ" ตอนรออนุมัติ: engine ยกเลิกได้เฉพาะคำขอ APPROVED (PENDING → 400 เสมอ)
      // คำขอที่ยังรออนุมัติมีทางออกเดียวคือเจ้าของ "ปฏิเสธ"
      if (isOwner && data.exchangeRequestId)
        out.push({ kind: 'dialog', label: 'ปฏิเสธ', dialog: 'reject-priced', destructive: true });
      // M1 — เคสที่ผูกคำขอไม่สำเร็จ (ไม่มีคำขอให้ปฏิเสธ) ยกเลิกเคสได้แทน
      if (isMgr && bareExchange)
        out.push({ kind: 'dialog', label: 'ยกเลิกเคส', dialog: 'cancel', destructive: true });
    } else if (stage === 'READY_FOR_PICKUP') {
      if (isMgr) out.push({ kind: 'dialog', label: 'ยกเลิกคำขอ', dialog: 'cancel-swap' });
    }
    return out;
  }

  return out;
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

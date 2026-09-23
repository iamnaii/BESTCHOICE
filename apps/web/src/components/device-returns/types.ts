/**
 * ใบรับเครื่องคืน (device-return intake) — shared web types + label maps.
 *
 * Mirror ของ shape ฝั่ง API (`apps/api/src/modules/device-returns/`): Decimal → string,
 * Date → ISO string. ห้าม `Number()` แล้ว re-serialize — แสดงผ่าน `formatNumberDecimal`/`fmtMoney`.
 * Spec: docs/superpowers/specs/2026-09-20-device-return-intake-design.md §4, §5.0, §7
 */

export type DeviceReturnStatus = 'PENDING_CONFIRM' | 'CONFIRMED' | 'REJECTED' | 'CANCELED';
export type DeviceReturnKind = 'VOLUNTARY' | 'REPOSSESSION';
export type ReturnReason = 'UNAFFORDABLE' | 'NO_LONGER_NEEDED' | 'AFTER_TERMINATION' | 'OTHER';
export type ConditionGrade = 'A' | 'B' | 'C' | 'D';
export type LineNotifyStatus = 'SENT' | 'FAILED' | 'NO_LINE';

/** แถวจาก `GET /device-returns` / `GET /device-returns/:id` / ผลของ create-confirm-reject-cancel */
export interface DeviceReturnRow {
  id: string;
  docNumber: string;
  status: DeviceReturnStatus;
  returnKind: DeviceReturnKind;
  returnReason: ReturnReason;
  deviceReceivedAt: string;
  conditionGrade: ConditionGrade;
  appraisalPrice: string;
  /** snapshot ตารางรับซื้อ ณ วันสร้าง — null = ไม่มีรุ่นในตาราง (สาขาตีราคาเอง) */
  tableBasePrice: string | null;
  repairCost: string;
  notes: string | null;
  lineNotifyStatus: LineNotifyStatus | null;
  lineNotifiedAt: string | null;
  receivingBranch: { id: string; name: string };
  receivedBy: { id: string; name: string };
  contract: {
    id: string;
    contractNumber: string;
    status: string;
    customer: { id: string; name: string };
    product: { id: string; brand: string; model: string; imeiSerial: string | null };
  };
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string } | null;
  repossessionId: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface DeviceReturnListResponse {
  data: DeviceReturnRow[];
  total: number;
  page: number;
  limit: number;
}

/** POST /device-returns/:id/cancel and /reject return the refreshed row and any accounting notice. */
export interface CloseDeviceReturnResponse extends DeviceReturnRow {
  notice: string | null;
}

/** `GET /device-returns/preview?contractId&conditionGrade&appraisalPrice` */
export interface DeviceReturnPreview {
  contract: {
    id: string;
    contractNumber: string;
    status: string;
    customer: { id: string; name: string };
    product: {
      id: string;
      brand: string;
      model: string;
      storage: string | null;
      imeiSerial: string | null;
    };
    branch: { id: string; name: string };
  };
  /** ระบบ derive จากสถานะสัญญา (TERMINATED → REPOSSESSION; เดิน → VOLUNTARY); null = สถานะไม่เข้าเกณฑ์ */
  returnKind: DeviceReturnKind | null;
  eligibility: { canCreate: boolean; reason: string | null };
  allowedReasons: ReturnReason[];
  valuation: {
    grade: string;
    found: boolean;
    suggestedPrice: number | null;
    note: string | null;
  } | null;
  deviationPct: number | null;
  outstandingBalance: string;
}

/** `GET /device-returns/lookup?q=` — รายการสั้น ไม่มี PII เกินจำเป็น (ไม่มีเบอร์โทร) */
export interface DeviceReturnLookupRow {
  id: string;
  contractNumber: string;
  status: string;
  customer: { id: string; name: string };
  product: { id: string; brand: string; model: string; imeiSerial: string | null } | null;
  branch: { id: string; name: string } | null;
}

/** `GET /device-returns/awaiting-repossession` — TERMINATED ที่ยังไม่มีใบค้างยืนยันและไม่มีแถว Repossession */
export interface AwaitingRepossessionRow {
  id: string;
  contractNumber: string;
  status: string;
  monthlyPayment: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string } | null;
  branch: { id: string; name: string } | null;
}

export interface AwaitingRepossessionResponse {
  data: AwaitingRepossessionRow[];
  total: number;
}

/** body ของ `POST /device-returns` (CreateDeviceReturnDto) */
export interface CreateDeviceReturnPayload {
  contractId: string;
  deviceReceivedAt: string;
  conditionGrade: ConditionGrade;
  appraisalPrice: number;
  repairCost?: number;
  returnReason: ReturnReason;
  notes?: string;
  /** OWNER เท่านั้น — BM/SALES ใช้ `user.branchId` ฝั่ง server */
  receivingBranchId?: string;
}

/** body ของ `POST /device-returns/:id/confirm` */
export interface ConfirmDeviceReturnPayload {
  paymentDate?: string;
  discountPct?: number;
}

export const GRADES: ConditionGrade[] = ['A', 'B', 'C', 'D'];

export const RETURN_REASON_OPTIONS: { value: ReturnReason; label: string }[] = [
  { value: 'UNAFFORDABLE', label: 'ลูกค้าไม่สามารถผ่อนต่อได้' },
  { value: 'NO_LONGER_NEEDED', label: 'ลูกค้าไม่ประสงค์ใช้งานต่อ' },
  { value: 'AFTER_TERMINATION', label: 'รับเครื่องคืนหลังบอกเลิกสัญญา' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = Object.fromEntries(
  RETURN_REASON_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ReturnReason, string>;

export const DEVICE_RETURN_KIND_LABEL: Record<DeviceReturnKind, string> = {
  VOLUNTARY: 'ลูกค้าคืนเอง',
  REPOSSESSION: 'ยึดเครื่อง',
};

export const DEVICE_RETURN_STATUS_LABEL: Record<DeviceReturnStatus, string> = {
  PENDING_CONFIRM: 'รอ FINANCE ยืนยัน',
  CONFIRMED: 'ยืนยันแล้ว',
  REJECTED: 'ส่งกลับ',
  CANCELED: 'ยกเลิก',
};

export const LINE_STATUS_LABEL: Record<LineNotifyStatus, string> = {
  SENT: 'ส่งไลน์แล้ว',
  FAILED: 'ส่งไลน์ไม่สำเร็จ',
  NO_LINE: 'ไม่มีไลน์ผูก',
};

/** `POST /device-returns` (spec §5.0) — SALES สร้างได้แต่ไม่มี route มา /repossessions จึงสร้างจากหน้าสัญญา */
export const DEVICE_RETURN_CREATE_ROLES = ['OWNER', 'BRANCH_MANAGER', 'SALES'];
/** `POST /device-returns/:id/confirm` + `/reject` */
export const DEVICE_RETURN_CONFIRM_ROLES = ['OWNER', 'FINANCE_MANAGER'];
/**
 * ดูตัวเลขยอดปิด/P&L ก่อนยืนยัน = `GET /repossessions/preview/:contractId` — ทุก role
 * (คำสั่งเจ้าของ 2026-09-23: "คนอื่นคำนวณได้ แต่ผู้จัดการอนุมัติทีหลัง"); ยืนยันยัง
 * DEVICE_RETURN_CONFIRM_ROLES เท่านั้น
 */
export const DEVICE_RETURN_PREVIEW_ROLES = [
  'OWNER',
  'FINANCE_MANAGER',
  'BRANCH_MANAGER',
  'ACCOUNTANT',
  'SALES',
];
/** `POST /device-returns/:id/resend-line` */
export const DEVICE_RETURN_RESEND_ROLES = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];
/** สถานะสัญญาที่รับเครื่องคืนได้ (spec §5.1 ข้อ 2) — server เป็นผู้ตัดสินจริงผ่าน preview.eligibility */
export const DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES = [
  'ACTIVE',
  'OVERDUE',
  'DEFAULT',
  'TERMINATED',
];

/** ด่านตารางรับซื้อ ±15% — ชุดเดียวกับ `RepossessionsService.TABLE_DEVIATION_LIMIT` */
export const TABLE_DEVIATION_LIMIT_PCT = 15;
export const REJECT_REASON_MIN = 10;
export const REJECT_REASON_MAX = 500;

/** Today's date in Asia/Bangkok (YYYY-MM-DD) — avoids UTC off-by-one during BKK evening. */
export function bkkToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/** % ต่างจากตารางรับซื้อ (ตรรกะเดียวกับ RepossessionOverlay เดิม) — null เมื่อคำนวณไม่ได้ */
export function computeDeviationPct(appraisal: number, tablePrice: number | null): number | null {
  if (tablePrice === null || !(tablePrice > 0)) return null;
  if (!Number.isFinite(appraisal) || !(appraisal > 0)) return null;
  return ((appraisal - tablePrice) / tablePrice) * 100;
}

export function formatDeviationLabel(pct: number | null): string {
  if (pct === null) return '';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

/**
 * `POST /device-returns/:id/cancel` — OWNER ทุกใบ; BRANCH_MANAGER เฉพาะใบที่
 * `receivingBranchId = user.branchId` (server บังคับซ้ำ, ไม่มี branchId = fail-closed)
 */
export function canCancelDeviceReturn(
  user: { role?: string; branchId?: string | null } | null | undefined,
  row: Pick<DeviceReturnRow, 'receivingBranch'>,
): boolean {
  if (!user) return false;
  if (user.role === 'OWNER') return true;
  if (user.role === 'BRANCH_MANAGER')
    return !!user.branchId && user.branchId === row.receivingBranch.id;
  return false;
}

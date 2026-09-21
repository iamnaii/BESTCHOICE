/** นับเงินปิดยอดลิ้นชักสาขา — ชนิดข้อมูล + ตัวช่วยที่กล่องปิดยอด / แท็บประวัติ / ตารางรายการใช้ร่วมกัน */

export type CashCloseStatus = 'PENDING_CONFIRM' | 'CONFIRMED' | 'SENT_BACK';
export type CashDestination = 'OWNER_HOLD' | 'BANK_DEPOSIT' | 'BRANCH_SAFE';

interface Person { id: string; name: string }

export interface CashClose {
  id: string; branchId: string; branchName: string; status: CashCloseStatus; attemptNo: number;
  periodStart: string | null; countedAt: string;
  floatAmount: number; cashIn: number; cashOut: number; expectedAmount: number; countedAmount: number;
  varianceAmount: number; varianceReason: string | null; sendAmount: number; countedBy: Person;
  receivedAmount: number | null; receiveVariance: number | null; receiveNote: string | null;
  destination: CashDestination | null; confirmedBy: Person | null; confirmedAt: string | null;
  sentBackBy: Person | null; sentBackAt: string | null; sentBackReason: string | null;
  /** ลงบัญชีตอนยืนยันรับเงินแล้วหรือยัง (false หลังยืนยัน = ไม่มียอดให้ลง หรือสาขายังไม่ตั้งบัญชีลิ้นชัก) */
  journalPosted: boolean;
  depositReference: string | null;
  hasDepositSlip: boolean;
  moneyState: CashCloseMoneyState;
}

export interface CashCloseStatusResponse {
  date: string; asOf: string; branchId: string; branchName: string;
  round: { periodStart: string | null; floatAmount: number; cashIn: number; cashOut: number; expectedAmount: number; movementCount: number };
  closes: CashClose[];
  awaitingConfirm: CashClose[];
  /** สิ่งที่สาขาต้องมีก่อนปิดยอดได้ + ชื่อคนที่นับเงินได้ */
  readiness: { hasDrawerAccount: boolean; floatAmount: number; counters: { id: string; name: string; role: string }[] };
  holdings: CashHolding[];
  permissions: { canCount: boolean; canConfirm: boolean; viewerId: string; viewerRole?: string };
}

export interface CashCloseHistoryResponse {
  month: string; branchId: string | null; rows: CashClose[];
  deposits: CashDeposit[];
  alerts: {
    unclosedYesterday: { branchId: string; branchName: string; date: string; cashIn: number }[];
    monthShortage: { branchId: string; branchName: string; count: number; amount: number }[];
    awaitingOverOneDay: CashClose[];
  };
}

export const DESTINATION_LABEL: Record<CashDestination, string> = {
  OWNER_HOLD: 'เจ้าของเก็บไว้',
  BANK_DEPOSIT: 'นำฝากธนาคารของร้าน',
  BRANCH_SAFE: 'ตู้เซฟสาขา',
};

export const STATUS_LABEL: Record<CashCloseStatus, string> = {
  PENDING_CONFIRM: 'รอยืนยันรับเงิน',
  CONFIRMED: 'ปิดยอดแล้ว',
  SENT_BACK: 'ตีกลับให้นับใหม่',
};

export const baht = (value: number | string) =>
  Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ทำงานเป็นสตางค์ กันเศษทศนิยมของ float */
export const toSatang = (value: number | string) => Math.round(Number(value) * 100);

/** "ขาด 200.00" / "เกิน 50.00" / "ตรง" — ส่วนต่าง = นับได้ − ต้องมี */
export function varianceLabel(variance: number) {
  const satang = toSatang(variance);
  if (satang === 0) return 'ตรง';
  return `${satang < 0 ? 'ขาด' : 'เกิน'} ${baht(Math.abs(satang) / 100)}`;
}

export const varianceTone = (variance: number) =>
  toSatang(variance) === 0 ? 'text-muted-foreground' : toSatang(variance) < 0 ? 'text-destructive' : 'text-warning';

const BKK = 'Asia/Bangkok';
export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BKK });
export const dayTimeOf = (iso: string) =>
  `${new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: BKK })} ${timeOf(iso)}`;

/** แปลงข้อความที่พิมพ์ ("12,510.00") เป็นจำนวนเงิน — ไม่ใช่ตัวเลข/ติดลบ/ทศนิยมเกิน 2 ตำแหน่ง = null */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** การปิดยอดที่ยังมีผล (ไม่ถูกตีกลับ) ครั้งล่าสุดของวัน — ขอบ "หลังปิดยอด" ของตารางรายการ */
export function latestEffectiveClose(closes: CashClose[]): CashClose | null {
  return closes.filter((c) => c.status !== 'SENT_BACK').sort((a, b) => b.countedAt.localeCompare(a.countedAt))[0] ?? null;
}

// ─── ปิดยอดทุกวัน + หลักฐานว่าเงินถึงบริษัท (mockup CnXmYLkT กระดาน 10–11 — เจ้าของเคาะ 2026-09-21) ───

/** เงินของการปิดยอดครั้งนั้นถึงบริษัทแล้วหรือยัง — ตู้เซฟสาขา = ยังอยู่ที่สาขา จนกว่าจะบันทึกนำฝากครบ */
export type CashCloseMoneyState = 'AWAITING_CONFIRM' | 'REACHED' | 'AT_BRANCH' | 'SENT_BACK';
/** สถานะของหนึ่งวันของหนึ่งสาขา (ตารางสถานะของวัน + แถบ 14 วัน) */
export type CashCloseDayState = 'REACHED' | 'AT_BRANCH' | 'AWAITING_CONFIRM' | 'NOT_COUNTED' | 'MISSED' | 'NO_CASH';
export type CashDepositSource = 'BRANCH_SAFE' | 'OWNER_HOLD';

export interface CashCloseOverviewRow {
  branchId: string; branchName: string; state: CashCloseDayState; close: CashClose | null; closeCount: number;
  dayCashIn: number; dayCashOut: number; lastCashInAt: string | null;
  round: { floatAmount: number; cashIn: number; cashOut: number; expectedAmount: number; periodStart: string | null } | null;
  canConfirm: boolean;
}

export interface CashHolding {
  branchId: string; branchName: string; source: CashDepositSource; sourceLabel: string; reachedCompany: boolean;
  outstanding: number; closeCount: number; oldestConfirmedAt: string | null;
  openCloses: { id: string; confirmedAt: string; outstanding: number }[];
  canDeposit: boolean;
}

export interface CashDeposit {
  id: string; branchId: string; branchName: string; source: CashDepositSource; sourceLabel: string;
  amount: number; reference: string; note: string | null; depositedBy: Person; depositedAt: string; journalPosted: boolean;
}

export interface CashCloseOverviewResponse {
  date: string; today: string; asOf: string; viewerId: string; viewerRole: string;
  rows: CashCloseOverviewRow[];
  summary: { reached: number; atBranch: number; awaitingConfirm: number; notCounted: number; noCash: number };
  strip: { dates: string[]; rows: { branchId: string; branchName: string; cells: CashCloseDayState[] }[] };
  holdings: CashHolding[];
}

export interface CashCloseReminderResponse {
  missed: { branchId: string; branchName: string; date: string; cashIn: number; expectedAmount: number } | null;
  canCount: boolean;
}

export const DAY_STATE_LABEL: Record<CashCloseDayState, string> = {
  REACHED: 'ถึงบริษัทแล้ว',
  AT_BRANCH: 'รับเงินแล้ว ยังอยู่ที่สาขา',
  AWAITING_CONFIRM: 'นับแล้ว รอยืนยันรับเงิน',
  NOT_COUNTED: 'ยังไม่นับ',
  MISSED: 'มีเงินสดแต่ไม่ปิดยอด',
  NO_CASH: 'ไม่มีเงินสด',
};

/** ป้ายสถานะ (พื้น + ตัวอักษร) — ใช้โทเคนสีของธีมเท่านั้น */
export const DAY_STATE_BADGE: Record<CashCloseDayState, string> = {
  REACHED: 'bg-primary/10 text-primary',
  AT_BRANCH: 'bg-warning/10 text-warning',
  AWAITING_CONFIRM: 'bg-warning/10 text-warning',
  NOT_COUNTED: 'bg-destructive/10 text-destructive',
  MISSED: 'bg-destructive/10 text-destructive',
  NO_CASH: 'bg-muted text-muted-foreground',
};

/** ช่องของแถบ 14 วัน — วันนี้ที่ยังไม่นับ = กรอบแดงโปร่ง (ยังไม่ถึงเวลาปิดยอด ไม่ใช่ "ไม่ปิดยอด") */
export const DAY_STATE_CELL: Record<CashCloseDayState, string> = {
  REACHED: 'bg-primary',
  AT_BRANCH: 'bg-warning',
  AWAITING_CONFIRM: 'bg-warning',
  NOT_COUNTED: 'border-2 border-dashed border-destructive bg-destructive/10',
  MISSED: 'bg-destructive',
  NO_CASH: 'bg-muted',
};

export const MONEY_STATE_LABEL: Record<CashCloseMoneyState, string> = {
  AWAITING_CONFIRM: 'รอยืนยันรับเงิน',
  REACHED: 'ถึงบริษัทแล้ว',
  AT_BRANCH: 'ยังอยู่ที่สาขา',
  SENT_BACK: 'ตีกลับให้นับใหม่',
};

export const MIN_DEPOSIT_REFERENCE = 6;
export const EVIDENCE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const EVIDENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const thaiShortDate = (date: string) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: BKK });

/** จำนวนวันเต็มตั้งแต่เวลานั้นถึงตอนนี้ (ปัดลง) */
export const daysSince = (iso: string, now: number = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));

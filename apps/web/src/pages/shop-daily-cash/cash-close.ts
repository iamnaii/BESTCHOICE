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
}

export interface CashCloseStatusResponse {
  date: string; asOf: string; branchId: string; branchName: string;
  round: { periodStart: string | null; floatAmount: number; cashIn: number; cashOut: number; expectedAmount: number; movementCount: number };
  closes: CashClose[];
  awaitingConfirm: CashClose[];
  permissions: { canCount: boolean; canConfirm: boolean; viewerId: string };
}

export interface CashCloseHistoryResponse {
  month: string; branchId: string | null; rows: CashClose[];
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

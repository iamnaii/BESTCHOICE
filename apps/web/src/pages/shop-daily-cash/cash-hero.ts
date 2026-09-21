import { AlertTriangle, Banknote, CheckCircle2, Clock, Lock, Minus, type LucideIcon } from 'lucide-react';
import type { CashClose, CashCloseDayState, CashCloseStatusResponse } from './cash-close';

/**
 * กล่องสถานะเดียวของหน้าสรุปเงินรายวัน (mockup CnXmYLkT กระดาน 15–16 — เจ้าของเคาะ 2026-09-21 ค่ำ).
 * หนึ่งวันของหนึ่งสาขามีได้หลายเรื่องพร้อมกัน (ยอดรอยืนยัน + รอบใหม่ + เงินในตู้เซฟ) — กล่องเลือก "เรื่องเดียว" ขึ้นเป็นตัวใหญ่
 * โดยเรียงจากสิ่งที่ผู้เปิดดูต้องลงมือเองก่อน แล้วค่อยเป็นสิ่งที่รอคนอื่น เรื่องที่เหลือไปอยู่แถวรองใต้กล่อง (ปุ่มใหญ่จึงมีได้ปุ่มเดียว)
 */
export type HeroKind = 'CONFIRM' | 'SEND' | 'DEPOSIT' | 'NOT_READY' | 'WAIT_CONFIRM' | 'WAIT_SEND' | 'DONE' | 'NO_CASH' | 'EMPTY_DAY';

export interface HeroPick {
  kind: HeroKind;
  /** การส่งยอดที่เป็นเรื่องหลัก (null = เรื่องหลักคือรอบปัจจุบัน/ไม่มีอะไร) */
  close: CashClose | null;
  /** การส่งยอดอื่นของวันที่ยังมีผล — แสดงเป็นแถวรอง */
  rest: CashClose[];
  /** ผู้เปิดดูเป็นคนที่ต้องกด (พื้นเหลือง + ปุ่มใหญ่) */
  viewerActs: boolean;
  /** รอบปัจจุบันมีเงินสดใหม่ แต่เรื่องหลักเป็นเรื่องอื่น ⇒ ต้องมีแถวรอง "รอบใหม่หลังส่งยอด" */
  roundPending: boolean;
  /** ส่งยอดของวันนี้ถูกตีกลับและยังไม่มีการส่งใหม่ ⇒ หัวข้อ "ส่งยอดอีกครั้ง" */
  resend: boolean;
}

export function pickHero(status: CashCloseStatusResponse, isToday: boolean): HeroPick {
  const { permissions, round, readiness } = status;
  const awaitingIds = new Set(status.awaitingConfirm.map((close) => close.id));
  const confirmed = status.closes
    .filter((close) => close.status === 'CONFIRMED' && !awaitingIds.has(close.id))
    .sort((a, b) => b.countedAt.localeCompare(a.countedAt));
  const effective = [...status.awaitingConfirm, ...confirmed];
  const canConfirmThis = (close: CashClose) => permissions.canConfirm && close.countedBy.id !== permissions.viewerId;
  const canDeposit = !!status.holdings.find((holding) => holding.source === 'BRANCH_SAFE')?.canDeposit;
  const notReady = isToday && (!readiness.hasDrawerAccount || readiness.counters.length === 0);
  const roundHasCash = isToday && round.movementCount > 0;
  const atBranch = confirmed.find((close) => close.moneyState === 'AT_BRANCH') ?? null;
  const reached = confirmed.find((close) => close.moneyState !== 'AT_BRANCH') ?? null;
  // ดูวันย้อนหลัง: เรื่องหลักต้องเป็นของวันนั้น — ยอดรอยืนยันของวันอื่น (API ส่งมาทุกวันให้กดยืนยันได้) ลงไปเป็นแถวรอง
  const dayIds = new Set(status.closes.map((close) => close.id));
  const awaitingHere = isToday ? status.awaitingConfirm : status.awaitingConfirm.filter((close) => dayIds.has(close.id));
  const mine = awaitingHere.find(canConfirmThis) ?? null;

  let kind: HeroKind;
  let close: CashClose | null = null;
  if (mine) { kind = 'CONFIRM'; close = mine; }
  else if (roundHasCash && permissions.canCount && !notReady) kind = 'SEND';
  else if (atBranch && canDeposit) { kind = 'DEPOSIT'; close = atBranch; }
  else if (notReady) kind = 'NOT_READY';
  else if (awaitingHere.length > 0) { kind = 'WAIT_CONFIRM'; close = awaitingHere[0]; }
  else if (roundHasCash) kind = 'WAIT_SEND';
  else if (atBranch) { kind = 'DEPOSIT'; close = atBranch; }
  else if (reached) { kind = 'DONE'; close = reached; }
  else kind = isToday ? 'NO_CASH' : 'EMPTY_DAY';

  return {
    kind, close,
    rest: effective.filter((item) => item.id !== close?.id),
    viewerActs: kind === 'CONFIRM' || kind === 'SEND' || (kind === 'DEPOSIT' && canDeposit),
    roundPending: roundHasCash && kind !== 'SEND' && kind !== 'WAIT_SEND' && kind !== 'NOT_READY',
    resend: kind === 'SEND' && effective.length === 0 && status.closes.some((item) => item.status === 'SENT_BACK'),
  };
}

// ─── สถานะของหนึ่งวัน: ไอคอน + ข้อความเสมอ ไม่บอกด้วยสีอย่างเดียว ───

export const DAY_STATE_ICON: Record<CashCloseDayState, LucideIcon> = {
  REACHED: CheckCircle2,
  AWAITING_CONFIRM: Clock,
  AT_BRANCH: Lock,
  MISSED: AlertTriangle,
  NOT_COUNTED: Banknote,
  NO_CASH: Minus,
};

/** ข้อความสั้นของแถบ 14 วัน (บรรทัดนับวันใต้แถบ) */
export const DAY_STATE_SHORT: Record<CashCloseDayState, string> = {
  REACHED: 'ถึงบริษัทแล้ว',
  AWAITING_CONFIRM: 'รอยืนยันรับเงิน',
  AT_BRANCH: 'ยังอยู่ที่สาขา',
  MISSED: 'มีเงินสดแต่ไม่ส่งยอด',
  NOT_COUNTED: 'ยังไม่ส่งยอด',
  NO_CASH: 'ไม่มีเงินสด',
};

/** ช่องวันของแถบ (พื้นการ์ด + ไอคอนสี) — โทเคนของธีมเท่านั้น */
export const DAY_STATE_TILE: Record<CashCloseDayState, string> = {
  REACHED: 'border-border bg-card text-primary',
  AWAITING_CONFIRM: 'border-warning/40 bg-warning/10 text-foreground',
  AT_BRANCH: 'border-warning/40 bg-card text-foreground',
  MISSED: 'border-destructive/30 bg-destructive/5 text-destructive',
  NOT_COUNTED: 'border-dashed border-warning bg-card text-foreground',
  NO_CASH: 'border-border bg-card text-muted-foreground',
};

export const DAY_STATE_ORDER: CashCloseDayState[] = ['REACHED', 'AWAITING_CONFIRM', 'AT_BRANCH', 'MISSED', 'NOT_COUNTED', 'NO_CASH'];

const BKK = 'Asia/Bangkok';
const WEEKDAY_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
/** "จ." … "อา." ของวันที่ YYYY-MM-DD (เวลาไทย) */
export const weekdayShort = (date: string) => WEEKDAY_SHORT[new Date(`${date}T12:00:00+07:00`).getUTCDay()];
export const thaiDayMonth = (date: string) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: BKK });

/** เลื่อนวัน ±n วันบนปฏิทิน (สตริง YYYY-MM-DD ไม่ผ่านเขตเวลาเครื่อง) */
export function shiftDate(date: string, days: number) {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

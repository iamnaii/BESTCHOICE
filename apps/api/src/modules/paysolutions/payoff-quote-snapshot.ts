import type { Prisma } from '@prisma/client';
import { bangkokDateString } from '../../utils/date.util';
import { d } from '../../utils/decimal.util';
import type { ContractPaymentService } from '../contracts/contract-payment.service';

/**
 * Task 41 (คำตัดสินเจ้าของ #43) — ส่วนของ `ContractPaymentService` ที่ PaySolutions ใช้: intent ปิดยอดถามยอดปิดของ server
 * (`getEarlyPayoffQuote` — ตัวเดียวกับหน้า LIFF ยอดปิด) · webhook ลงปิดยอดจริงผ่านแกนเดียวกับพนักงาน (`earlyPayoff` ทางเข้า `gatewayMatch`)
 */
export type PaySolutionsPayoffPort = Pick<
  ContractPaymentService,
  'getEarlyPayoffQuote' | 'earlyPayoff'
>;

/** สถานะสัญญาที่ปิดยอดก่อนกำหนดได้ — ชุดเดียวกับ `getEarlyPayoffQuote` / หน้า LIFF ยอดปิด */
export const PAYOFF_ELIGIBLE_CONTRACT_STATUSES: readonly string[] = [
  'ACTIVE',
  'OVERDUE',
  'DEFAULT',
];

export const PAYOFF_QUOTE_SNAPSHOT_VERSION = 1;

/**
 * ยอดปิดที่ server คำนวณตอนสร้าง intent ปิดยอด — เก็บบน `PaymentLink.payoffQuote` ของแถวติดตาม (ยอดเป็นสตริง 2 ตำแหน่ง)
 *
 * webhook ไม่ "ใช้ยอดเดิม" ของ snapshot ลงบัญชี: คำนวณยอดปิดใหม่ ณ เวลาที่เงินเข้าด้วย `discountPct` ตัวนี้ แล้วลง JP4 เมื่อเงินที่รับ
 * ตรงยอดปิด ณ เวลานั้น (±0.01) — ฟิลด์อื่นใช้บอกพนักงานในงานแจ้ง/Sentry ว่าลูกค้าเห็นยอดเท่าไร เมื่อวันไหน (หัวข้อ "ข้ามวัน" ใน accounting.md)
 */
export interface PayoffQuoteSnapshot {
  v: typeof PAYOFF_QUOTE_SNAPSHOT_VERSION;
  totalPayoff: string;
  /** % ส่วนลด (0–50 หลัง clamp ของ `computePayoffQuote`) — ตัวที่ webhook ใช้คำนวณยอดปิดใหม่ */
  discountPct: number;
  discountAmount: string;
  unpaidLateFees: string;
  remainingMonths: number;
  notDueMonths: number;
  /** วันที่ของ quote ตามปฏิทินไทย (YYYY-MM-DD) */
  quoteDate: string;
  quotedAt: string;
}

export function buildPayoffQuoteSnapshot(
  quote: {
    totalPayoff: number;
    discountPct: number;
    discountAmount: number;
    unpaidLateFees: number;
    remainingMonths: number;
    notDueMonths: number;
  },
  now: Date = new Date(),
): PayoffQuoteSnapshot {
  return {
    v: PAYOFF_QUOTE_SNAPSHOT_VERSION,
    totalPayoff: d(quote.totalPayoff).toFixed(2),
    discountPct: quote.discountPct,
    discountAmount: d(quote.discountAmount).toFixed(2),
    unpaidLateFees: d(quote.unpaidLateFees).toFixed(2),
    remainingMonths: quote.remainingMonths,
    notDueMonths: quote.notDueMonths,
    quoteDate: bangkokDateString(now),
    quotedAt: now.toISOString(),
  };
}

const MONEY = /^\d+\.\d{2}$/;

/** อ่าน snapshot จากคอลัมน์ JSON — รูปไม่ครบ/รุ่นไม่ตรง = null (webhook ถือว่าไม่มี → FIFO + งานแจ้ง) */
export function parsePayoffQuoteSnapshot(
  value: Prisma.JsonValue | null | undefined,
): PayoffQuoteSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  if (s.v !== PAYOFF_QUOTE_SNAPSHOT_VERSION) return null;
  if (typeof s.totalPayoff !== 'string' || !MONEY.test(s.totalPayoff)) return null;
  if (
    typeof s.discountPct !== 'number' ||
    !Number.isFinite(s.discountPct) ||
    s.discountPct < 0 ||
    s.discountPct > 100
  ) {
    return null;
  }
  if (typeof s.quoteDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.quoteDate)) return null;
  return {
    v: PAYOFF_QUOTE_SNAPSHOT_VERSION,
    totalPayoff: s.totalPayoff,
    discountPct: s.discountPct,
    discountAmount: typeof s.discountAmount === 'string' ? s.discountAmount : '0.00',
    unpaidLateFees: typeof s.unpaidLateFees === 'string' ? s.unpaidLateFees : '0.00',
    remainingMonths: typeof s.remainingMonths === 'number' ? s.remainingMonths : 0,
    notDueMonths: typeof s.notDueMonths === 'number' ? s.notDueMonths : 0,
    quoteDate: s.quoteDate,
    quotedAt: typeof s.quotedAt === 'string' ? s.quotedAt : '',
  };
}

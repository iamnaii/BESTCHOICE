import { THAI_MONTHS_SHORT, formatThaiDateTime } from '@/lib/date';
import type { Booking, BookingStatus } from './types';

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING_DEPOSIT: 'รอชำระมัดจำ',
  PAID: 'มัดจำแล้ว',
  CANCELED: 'ยกเลิก',
  EXPIRED: 'หมดอายุ',
  CONVERTED: 'ขายแล้ว',
};

export const STATUS_VARIANT: Record<
  BookingStatus,
  'primary' | 'secondary' | 'destructive' | 'outline' | 'success' | 'info'
> = {
  PENDING_DEPOSIT: 'info',
  PAID: 'success',
  CANCELED: 'destructive',
  EXPIRED: 'outline',
  CONVERTED: 'primary',
};

export const OPEN_STATUSES: readonly BookingStatus[] = ['PENDING_DEPOSIT', 'PAID'];
export const isOpenStatus = (status: BookingStatus): boolean => OPEN_STATUSES.includes(status);

export function computeBookingTotal(items: { quantity: number; unitPrice: number }[]): number {
  return items.reduce((sum, it) => sum + Math.round(it.quantity * it.unitPrice * 100) / 100, 0);
}

/** คำตัดสินเจ้าของ 2026-10-05: มัดจำต้อง > 0 (ไม่มีมัดจำ = ไม่มีอะไรให้ล็อกเครื่อง) และไม่เกินยอดรวม */
export function isDepositInRange(depositAmount: number, totalAmount: number): boolean {
  if (!Number.isFinite(depositAmount) || !Number.isFinite(totalAmount)) return false;
  return depositAmount > 0 && depositAmount <= totalAmount;
}

const toNumber = (v: string | number): number => (typeof v === 'string' ? parseFloat(v) : v);

export function fmtMoney(v: string | number): string {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtMoneyShort(v: string | number): string {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return '0';
  const whole = Number.isInteger(Math.round(n * 100) / 100) && Number.isInteger(n);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function fmtDate(iso: string): string {
  return formatThaiDateTime(iso, 'Asia/Bangkok');
}

/** D MMM YY (พ.ศ.) ตามปฏิทินไทย — เหมือน `formatThaiDateShort` แต่ไม่ขึ้นกับ TZ ของเครื่อง */
export function fmtBangkokDateShort(input: number | string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const yy = String((get('year') + 543) % 100).padStart(2, '0');
  return `${get('day')} ${THAI_MONTHS_SHORT[get('month') - 1]} ${yy}`;
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const bangkokDayIndex = (ms: number): number => Math.floor((ms + BANGKOK_OFFSET_MS) / 86_400_000);

/** จำนวนวันปฏิทินไทยจาก "ตอนนี้" ถึง `iso` (0 = วันเดียวกัน) */
export function bangkokDayDiff(iso: string, nowMs: number): number {
  return bangkokDayIndex(new Date(iso).getTime()) - bangkokDayIndex(nowMs);
}

export function awaitingExpiry(b: Pick<Booking, 'status' | 'expireDate'>, nowMs: number): boolean {
  return isOpenStatus(b.status) && new Date(b.expireDate).getTime() <= nowMs;
}

export type ExpiryTone = 'normal' | 'soon' | 'today' | 'overdue' | 'closed';
export interface ExpiryInfo {
  label: string;
  sub: string;
  tone: ExpiryTone;
}

/** วันสุดท้ายที่ใช้ได้ = 1 ms ก่อน expireDate (ฟอร์มเก็บเป็นเที่ยงคืนไทยของวันถัดไป — `toBangkokExpiryInstant`) */
export const lastValidMs = (expireDate: string): number => new Date(expireDate).getTime() - 1;

/** คอลัมน์/แถบ "หมดอายุ": ใบเปิด = วันคงเหลือ · ใบปิดแล้ว = เหตุการณ์ที่ปิด */
export function describeExpiry(
  b: Pick<
    Booking,
    'status' | 'expireDate' | 'convertedAt' | 'canceledAt' | 'depositPaidAt' | 'depositAmount'
  >,
  nowMs: number,
): ExpiryInfo {
  const lastValid = lastValidMs(b.expireDate);
  if (b.status === 'CONVERTED') {
    return {
      label: 'ขายแล้ว',
      sub: b.convertedAt ? fmtBangkokDateShort(b.convertedAt) : '',
      tone: 'closed',
    };
  }
  if (b.status === 'CANCELED') {
    const when = b.canceledAt ? fmtBangkokDateShort(b.canceledAt) : '';
    return {
      label: 'ยกเลิก',
      sub: b.depositPaidAt && when ? `คืนมัดจำ ${when}` : when,
      tone: 'closed',
    };
  }
  if (b.status === 'EXPIRED') {
    return {
      label: 'หมดอายุ',
      sub: b.depositPaidAt
        ? `ริบมัดจำ ${fmtMoneyShort(b.depositAmount)}`
        : fmtBangkokDateShort(lastValid),
      tone: 'closed',
    };
  }
  if (new Date(b.expireDate).getTime() <= nowMs) {
    return { label: 'หมดอายุแล้ว', sub: 'รอระบบปิด', tone: 'overdue' };
  }
  const days = bangkokDayDiff(new Date(lastValid).toISOString(), nowMs);
  const sub = fmtBangkokDateShort(lastValid);
  if (days <= 0) return { label: 'วันนี้', sub, tone: 'today' };
  if (days === 1) return { label: 'พรุ่งนี้', sub, tone: 'soon' };
  return { label: `อีก ${days} วัน`, sub, tone: days <= 3 ? 'soon' : 'normal' };
}

/** "5 ต.ค. 69 10:42" สำหรับคอลัมน์เลขที่ — เวลาไทยเสมอ ไม่ขึ้นกับ TZ ของเครื่อง */
export function formatCreated(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${fmtBangkokDateShort(d)} ${time}`;
}

import { THAI_MONTHS_SHORT } from '@/lib/date';
import type { PriceListCategory, PriceQuoteRow, RateTerms } from './types';

export const RATE1_TITLE = 'เรท 1 · ผ่อนกับ BESTCHOICE';
export const RATE2_TITLE = 'เรท 2 · ผ่อนกับ GFIN';
/** เรท 1 ว่าง = รุ่นนี้ไม่มีราคาผ่อน BESTCHOICE หรือหมวดนี้ยังไม่มีตั้งค่าดอกเบี้ย (`buildModelQuote` → `rate1 = null`) */
export const RATE1_MISSING = 'ยังไม่ได้ตั้งราคาผ่อน BESTCHOICE';

const BANGKOK = 'Asia/Bangkok';
const baht = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

export function formatBaht(amount: number): string {
  return baht.format(amount);
}

export function formatCash(amount: number | null): string {
  return amount == null ? '—' : formatBaht(amount);
}

/** "iPhone 15 · 128GB" (ตาม mockup) */
export function rowTitle(row: Pick<PriceQuoteRow, 'model' | 'storage'>): string {
  const storage = row.storage.trim();
  return storage ? `${row.model} · ${storage}` : row.model;
}

export function warrantyLabel(hasWarranty: boolean | null): string | null {
  if (hasWarranty === null) return null;
  return hasWarranty ? 'มีประกัน' : 'ไม่มีประกัน';
}

/** ป้ายประกันของแถว — มีแค่มือ 2 (สเปคข้อ 6) · มือ 1 / แท็บเล็ต = null เสมอ */
export function rowWarranty(row: Pick<PriceQuoteRow, 'category' | 'hasWarranty'>): boolean | null {
  return row.category === 'PHONE_USED' ? row.hasWarranty : null;
}

/** ชื่อแถวสำหรับโปรแกรมอ่านจอ — แถวมือ 2 ที่แยกตามประกันต้องแยกชื่อกันได้ */
export function rowLabel(row: Pick<PriceQuoteRow, 'model' | 'storage' | 'category' | 'hasWarranty'>): string {
  const warranty = warrantyLabel(rowWarranty(row));
  return warranty ? `${rowTitle(row)} (${warranty})` : rowTitle(row);
}

/** [มือที่ดูอยู่, มือที่ชวนสลับไป] */
const HAND: Record<PriceListCategory, [number, number]> = {
  PHONE_NEW: [1, 2],
  PHONE_USED: [2, 1],
};

/** ข้อความไม่พบ — สเปคข้อ 6 ตรงทุกตัวอักษร */
export function notFoundMessage(q: string, category: PriceListCategory): string {
  const [hand, other] = HAND[category];
  return `ไม่พบ "${q}" ในตารางราคา มือ ${hand} — ลองสลับเป็นมือ ${other} หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้`;
}

/** ไม่ได้ค้นอะไรแต่หมวดนี้ไม่มีแถวเลย */
export function emptyListMessage(category: PriceListCategory): string {
  return `ยังไม่มีราคามือ ${HAND[category][0]} ในตารางราคา — แจ้งเจ้าของให้เพิ่มราคา`;
}

/** "16 ต.ค. 2569 14:30 น." ตามเวลาไทย · ค่าเสีย = null */
export function formatUpdatedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const month = THAI_MONTHS_SHORT[Number(part('month')) - 1];
  return `${Number(part('day'))} ${month} ${Number(part('year')) + 543} ${part('hour')}:${part('minute')} น.`;
}

export type RateView = { ok: true; terms: RateTerms } | { ok: false; text: string };

export function rate1View(rate: PriceQuoteRow['rate1']): RateView {
  return rate ? { ok: true, terms: rate } : { ok: false, text: RATE1_MISSING };
}

export function rate2View(rate: PriceQuoteRow['rate2']): RateView {
  return 'unavailable' in rate ? { ok: false, text: rate.unavailable } : { ok: true, terms: rate };
}

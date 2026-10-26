import { formatNumberDecimal } from '@/utils/formatters';
import { toBangkokDateString } from '@/lib/date';

/** 6,514.00 */
export const money = (value: string | number | null | undefined): string => formatNumberDecimal(Number(value ?? 0) || 0, 2);

/** +10,000.00 · −3,486.00 (เครื่องหมายลบยาว U+2212 อ่านง่ายกว่าขีดสั้น) */
export const signedMoney = (value: string | number, sign: '+' | '-'): string => `${sign === '+' ? '+' : '−'}${money(value)}`;

export const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** "2026-10" → "ตุลาคม 2569" */
export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${THAI_MONTHS[Number(match[2]) - 1] ?? match[2]} ${Number(match[1]) + 543}`;
}

/** 12 เดือนล่าสุด (ใหม่สุดก่อน) สำหรับช่องเลือกเดือน — รวมเดือนที่เลือกอยู่เสมอ */
export function monthOptions(selected: string, todayIso: string = toBangkokDateString()): { key: string; label: string }[] {
  const [y, m] = todayIso.split('-').map(Number);
  const keys: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  if (selected && !keys.includes(selected)) keys.push(selected);
  return keys.sort((a, b) => (a < b ? 1 : -1)).map((key) => ({ key, label: monthLabel(key) }));
}

export const newRequestId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** ยอดที่ผู้ใช้พิมพ์ → ตัวเลข 2 ตำแหน่ง (null = ว่าง/ไม่ใช่ตัวเลข) */
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export const hasMoreThanTwoDecimals = (raw: string): boolean => /\.\d{3,}$/.test(raw.trim());

export const EVIDENCE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const EVIDENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PETTY_CASH_MAX_LIMIT = 1_000_000;

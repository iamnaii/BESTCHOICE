import type { InterestConfig } from './types';

/**
 * หมวดนี้มีตารางดอกเบี้ยรายงวด (`allowedMonths` ไม่ว่าง) — สัญญาคิดดอกเบี้ยรวมทั้งสัญญาจากแถวของงวด
 * (`getRateForMonths`) ไม่ใช่ดอกเบี้ยต่อเดือน × งวด ⇒ ป้ายต้องโชว์ % ทั้งสัญญาและงวดที่มีแถว
 */
export function hasTermRates(config: Pick<InterestConfig, 'allowedMonths'> | null | undefined): boolean {
  return (config?.allowedMonths?.length ?? 0) > 0;
}

/** เศษส่วน → เปอร์เซ็นต์ ทศนิยมไม่เกิน 2 ตำแหน่ง ตัดศูนย์ท้าย: 0.5 → "50%" · 0.04166667 → "4.17%" */
export function formatRatePct(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

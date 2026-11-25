import { displayInstallment } from '@installment/shared';

/** ผลคิดของหนึ่งเรทเท่าที่ใช้เปรียบเทียบ */
export interface ComparableQuote {
  available: boolean;
  downAmount?: number;
  monthlyPayment?: number;
  months?: number;
}

export const FREE_DOWN_BADGE = 'ฟรีดาวน์';

export function isFreeDown(quote: ComparableQuote | undefined): boolean {
  return !!quote?.available && quote.downAmount === 0;
}

/**
 * ป้ายบอกว่าเรทนี้ดีกว่าอีกเรทตรงไหน — คิดจากตัวเลขจริงของเครื่องนั้น (เจ้าของ 2026-11-25:
 * ไม่บอกว่าเป็นของใคร ไม่โชว์ยอดรวมจ่าย) · เท่ากัน = ไม่ขึ้นป้าย
 */
export function compareBadges(
  mine: ComparableQuote | undefined,
  other: ComparableQuote | undefined,
): string[] {
  if (!mine?.available) return [];
  const badges: string[] = [];
  const free = isFreeDown(mine);
  if (free) badges.push(FREE_DOWN_BADGE);
  if (!other?.available) return badges;

  const both = (a: number | undefined, b: number | undefined): a is number =>
    typeof a === 'number' && typeof b === 'number';
  if (!free && both(mine.downAmount, other.downAmount) && mine.downAmount < other.downAmount!) {
    badges.push('ดาวน์น้อยกว่า');
  }
  if (
    both(mine.monthlyPayment, other.monthlyPayment) &&
    displayInstallment(mine.monthlyPayment) < displayInstallment(other.monthlyPayment!)
  ) {
    badges.push('ค่างวดต่ำกว่า');
  }
  if (both(mine.months, other.months) && mine.months < other.months!) {
    badges.push('ผ่อนจบเร็วกว่า');
  }
  return badges;
}

import { Prisma } from '@prisma/client';
import { sqlBkkDate } from './bangkok-sql.util';

/**
 * เงื่อนไข "งวดชำระล่าช้า" ของ watch list (ตาราง payments alias `p`) — จ่ายในวันตามปฏิทินไทยที่**หลัง**วันครบกำหนดตามปฏิทินไทย
 * (จ่ายภายในวันครบกำหนด = ตรงเวลา) · เดิม `p.paid_date::date > p.due_date::date` ตัดวันตาม UTC: due_date เก็บเที่ยงคืนไทย
 * (= 17:00Z ของวันก่อน) ⇒ จ่ายตรงวันครบกำหนดหลัง 07:00 น. ถูกนับว่าล่าช้า (2026-11-18)
 */
export const LATE_PAYMENT_SQL = Prisma.sql`p.paid_date IS NOT NULL AND ${sqlBkkDate('p.paid_date')} > ${sqlBkkDate('p.due_date')}`;

export function calculatePaymentWatchRisk(input: {
  latePaymentCount: unknown;
  partialPaymentCount: unknown;
  hadDunningReset: unknown;
}) {
  const late = Number(input.latePaymentCount);
  const partial = Number(input.partialPaymentCount);
  const dunningReset = Boolean(input.hadDunningReset);
  const score = Math.min(late, 5) + partial * 2 + (dunningReset ? 3 : 0);
  const riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

  const reasons: string[] = [];
  if (late >= 2) reasons.push(`ชำระล่าช้า ${late} ครั้ง`);
  if (partial >= 1) reasons.push(`จ่ายไม่ครบ ${partial} ครั้ง`);
  if (dunningReset) reasons.push('เคยถูกติดตามหนี้แล้ว reset');

  return { late, partial, dunningReset, score, riskLevel, reasons };
}

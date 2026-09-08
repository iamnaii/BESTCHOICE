import { Prisma } from '@prisma/client';

import type { LateFeeConfig } from '../../utils/late-fee.util';
import { resolveLivePaymentLateFee } from '../../utils/late-fee.util';
import { bkkDateStr } from './_context';

/**
 * Pure helpers ของโหมดเดินเรื่อง (เฟส 3) — แยกไฟล์จาก _drive.ts เพื่อให้ spec
 * import ได้โดยไม่ลาก TestPackModule (กราฟ feature module เกือบทั้งแอป) เข้า jest
 */

/** เดือนไทย (YYYYMM) ของวันที่ — ใช้กับ month-guard ของก้าวที่คุมวันที่ลงบัญชีไม่ได้ */
export const bkkMonthKey = (d: Date): string => bkkDateStr(d).slice(0, 6);

/**
 * ค่าปรับที่ orchestrator จะคิด ณ วันโพสต์ — mirror ของ
 * payment-receipt-orchestrator.ts:268-284 ทีละกิ่ง (ห้ามลดรูป):
 *   - ไม่ waived และเลยกำหนด ณ postDate → resolve ใหม่จาก bracket config
 *     (ผ่าน resolveLivePaymentLateFee ซึ่งห่อ resolveLateFee ตัวเดียวกับ service
 *     — single source ไม่มีสำเนาสูตรที่สอง)
 *   - นอกนั้น (waived หรือยังไม่เลยกำหนด ณ postDate) → ใช้ค่าที่ stamp ไว้บนแถว
 *     เพราะ service ไม่ recompute ในกิ่งนี้ — seeder stamp ค่าปรับเทียบกับ "วันนี้"
 *     ส่วน POST_DATE อาจเป็นคนละวัน ⇒ ต้อง mirror ทั้งสองกิ่งไม่ใช่ resolve อย่างเดียว
 *     (waived ที่ approve ผ่าน flow จริงจะถูก zero ค่า lateFee อยู่แล้ว ⇒ กิ่งนี้ = 0)
 */
export function lateFeeAtPostDate(
  row: {
    dueDate: Date;
    amountDue: Prisma.Decimal | string | number;
    amountPaid?: Prisma.Decimal | string | number;
    lateFee: Prisma.Decimal | string | number;
    lateFeeWaived: boolean;
  },
  cfg: LateFeeConfig,
  postDate: Date,
): Prisma.Decimal {
  if (!row.lateFeeWaived && row.dueDate < postDate) {
    return resolveLivePaymentLateFee(row, cfg, postDate);
  }
  return new Prisma.Decimal(row.lateFee);
}

/**
 * ยอดคงเหลือของงวดตามที่ service จะตัดจริง ณ postDate (FEE-FIRST — PR #1313):
 * เต็มงวดรวมค่าปรับ = amountDue + lateFeeAtPostDate − amountPaid — พีชคณิตเดียวกับ
 * `remaining = (amountDue + lateFee − waiver) − prevPaid` ใน orchestrator (waiver = 0
 * เพราะโหมดเดินเรื่องไม่ยื่นอนุโลม). ค่าปรับ **ห้าม**อ่านจากคอลัมน์ตรง ๆ — orchestrator
 * re-resolve เทียบ effectivePaidDate เสมอ (บทเรียน fix round 1: จ่ายตามค่า stamp
 * ที่คนละวันกับ POST_DATE ทำให้ขาด/เกิน 50-100฿ แล้วงวดค้าง PARTIALLY_PAID).
 * คำนวณใน Prisma.Decimal ล้วน — .toNumber() เฉพาะขอบ service ที่ลายเซ็นบังคับ number
 */
export function remainingInstallmentDue(
  row: {
    dueDate: Date;
    amountDue: Prisma.Decimal | string | number;
    amountPaid: Prisma.Decimal | string | number;
    lateFee: Prisma.Decimal | string | number;
    lateFeeWaived: boolean;
  },
  cfg: LateFeeConfig,
  postDate: Date,
): Prisma.Decimal {
  return new Prisma.Decimal(row.amountDue)
    .plus(lateFeeAtPostDate(row, cfg, postDate))
    .minus(new Prisma.Decimal(row.amountPaid));
}

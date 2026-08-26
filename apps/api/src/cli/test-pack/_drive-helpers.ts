import { Prisma } from '@prisma/client';

import { bkkDateStr } from './_context';

/**
 * Pure helpers ของโหมดเดินเรื่อง (เฟส 3) — แยกไฟล์จาก _drive.ts เพื่อให้ spec
 * import ได้โดยไม่ลาก TestPackModule (กราฟ feature module เกือบทั้งแอป) เข้า jest
 */

/** เดือนไทย (YYYYMM) ของวันที่ — ใช้กับ month-guard ของก้าวที่คุมวันที่ลงบัญชีไม่ได้ */
export const bkkMonthKey = (d: Date): string => bkkDateStr(d).slice(0, 6);

/**
 * ยอดคงเหลือของงวด (FEE-FIRST convention — พีชคณิตเดียวกับ feeNettedOutstanding ใน
 * compute-cn-breakdown.ts): เต็มงวดรวมค่าปรับ = amountDue + netFee − amountPaid
 * (netFee = 0 เมื่อค่าปรับถูกอนุโลมทั้งงวด — PR #1313: จ่ายเต็มงวดต้องรวมค่าปรับเสมอ)
 * คำนวณใน Prisma.Decimal ล้วน — .toNumber() เฉพาะขอบ service ที่ลายเซ็นบังคับ number
 */
export function remainingInstallmentDue(row: {
  amountDue: Prisma.Decimal | string | number;
  amountPaid: Prisma.Decimal | string | number;
  lateFee: Prisma.Decimal | string | number;
  lateFeeWaived: boolean;
}): Prisma.Decimal {
  const netFee = row.lateFeeWaived ? new Prisma.Decimal(0) : new Prisma.Decimal(row.lateFee);
  return new Prisma.Decimal(row.amountDue).plus(netFee).minus(new Prisma.Decimal(row.amountPaid));
}

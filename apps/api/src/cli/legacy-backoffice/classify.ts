import type { ContractStatus } from '@prisma/client';
import { bangkokDateString } from '../../utils/date.util';
import type { LegacyContract, LegacyInstallment } from './legacy-book';

/**
 * จัดประเภทสัญญาระบบเก่า (สเปก 5.3) — ฟังก์ชันบริสุทธิ์
 *
 * | ระบบเก่า | ผล |
 * |---|---|
 * | 2 ผ่อนอยู่ | ACTIVE · OVERDUE เมื่อมีงวดค้างที่ครบกำหนดก่อนวันตัด ไม่งั้น ACTIVE |
 * | 3 สิ้นสุด | HISTORY · EARLY_PAYOFF เมื่อมีรายการปิดก่อนกำหนด ไม่งั้น COMPLETED |
 * | 4 ยกเลิก | SKIP `status-4-canceled` — ไม่นำเข้าเลย (คำตัดสินเจ้าของ 30/10) |
 * | 5 หนี้เสีย | SKIP `bad-debt-unsupported` — `planImport` ลงเป็นตัวบล็อก (ไม่ข้ามเงียบ: อาจมียอดค้างใน PEAK) |
 * | อื่น ๆ (0 ไม่มีสถานะ · 1 รอทำสัญญา) | SKIP `status-<รหัส>` |
 */

export type Classification = {
  kind: 'ACTIVE' | 'HISTORY' | 'SKIP';
  status: ContractStatus | null;
  reason: string | null;
};

/** สัญญาฉบับเก่า (ค่าปรับ "หลัง 3 วัน วันละ 50") = ทำสัญญาก่อนวันนี้ตามปฏิทินกรุงเทพ */
const NEW_FORM_FROM = '2025-11-14';

/** งวดค้าง = ระบบเก่ายังมียอดคงเหลือ (`ins_balance`) — งวดที่ปิดด้วยส่วนลดมีคงเหลือ 0 */
function isOverdue(installment: LegacyInstallment, cutoff: Date): boolean {
  return installment.balance.gt(0) && installment.dueDate.getTime() < cutoff.getTime();
}

/** เหตุผลของ SKIP ที่ `planImport` ลงเป็นตัวบล็อก `BAD_DEBT_UNSUPPORTED` แทนการข้าม */
export const BAD_DEBT_SKIP_REASON = 'bad-debt-unsupported';

/** @param cutoff วันตัดระบบ (2026-11-30 23:59:59 กรุงเทพ) */
export function classifyContract(c: LegacyContract, cutoff: Date): Classification {
  switch (c.statusCode) {
    case '2': {
      const overdue = c.installments.some((i) => isOverdue(i, cutoff));
      return { kind: 'ACTIVE', status: overdue ? 'OVERDUE' : 'ACTIVE', reason: null };
    }
    case '3':
      return { kind: 'HISTORY', status: c.close ? 'EARLY_PAYOFF' : 'COMPLETED', reason: null };
    case '4':
      return { kind: 'SKIP', status: null, reason: 'status-4-canceled' };
    case '5':
      return { kind: 'SKIP', status: null, reason: BAD_DEBT_SKIP_REASON };
    default:
      return { kind: 'SKIP', status: null, reason: `status-${c.statusCode}` };
  }
}

/** วันที่ทำสัญญา (`createdAt`) ตามปฏิทินกรุงเทพ < 2025-11-14 */
export function isOldForm(c: LegacyContract): boolean {
  return bangkokDateString(c.createdAt) < NEW_FORM_FROM;
}

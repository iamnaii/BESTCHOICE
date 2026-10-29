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
 * | 4 ยกเลิก · 5 หนี้เสีย | HISTORY ตามที่เจ้าของยืนยันใน `canceledMap` · ไม่อยู่ในรายชื่อ = SKIP `canceled-unconfirmed` |
 * | อื่น ๆ (0 ไม่มีสถานะ · 1 รอทำสัญญา) | SKIP `status-<รหัส>` |
 */

/** ผลของสัญญายกเลิกที่เจ้าของยืนยันทีละสัญญาจากช่อง `canceled_*` */
export type CanceledResolution = 'TERMINATED' | 'CANCELED' | 'CLOSED_BAD_DEBT' | 'EXCHANGED';

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

/**
 * @param cutoff วันตัดระบบ (2026-11-30 23:59:59 กรุงเทพ)
 * @param canceledMap เลขสัญญาเดิม (`LegacyContract.code`) → ผลที่เจ้าของยืนยัน
 */
export function classifyContract(
  c: LegacyContract,
  cutoff: Date,
  canceledMap: ReadonlyMap<string, CanceledResolution>,
): Classification {
  switch (c.statusCode) {
    case '2': {
      const overdue = c.installments.some((i) => isOverdue(i, cutoff));
      return { kind: 'ACTIVE', status: overdue ? 'OVERDUE' : 'ACTIVE', reason: null };
    }
    case '3':
      return { kind: 'HISTORY', status: c.close ? 'EARLY_PAYOFF' : 'COMPLETED', reason: null };
    case '4':
    case '5': {
      const resolved = canceledMap.get(c.code);
      return resolved
        ? { kind: 'HISTORY', status: resolved, reason: null }
        : { kind: 'SKIP', status: null, reason: 'canceled-unconfirmed' };
    }
    default:
      return { kind: 'SKIP', status: null, reason: `status-${c.statusCode}` };
  }
}

/** วันที่ทำสัญญา (`createdAt`) ตามปฏิทินกรุงเทพ < 2025-11-14 */
export function isOldForm(c: LegacyContract): boolean {
  return bangkokDateString(c.createdAt) < NEW_FORM_FROM;
}

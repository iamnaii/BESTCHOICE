import { ContractStatus } from '@prisma/client';

/**
 * สถานะสัญญาที่รอบตั้งลูกหนี้งวด (2A) ไม่ดูแล — สัญญาถูกบอกเลิก / ตัดหนี้สูญ / ผ่อนครบ /
 * ปิดยอดก่อนกำหนด / เปลี่ยนเครื่องไปแล้ว.
 *
 * แหล่งเดียว (คำตัดสินผู้คุมงาน R1, 2026-09-29): รอบกลางคืน (installment-accrual.cron.ts) และ
 * การตั้งลูกหนี้งวด ณ วันรับเงิน (PaymentReceiptTemplate) ใช้รายการนี้ตัวเดียวกัน — ห้ามมีสำเนา.
 * รูปเดียวกับ FINISHED_CONTRACT_STATUSES ใน product-hold.util.ts.
 */
export const ACCRUAL_EXCLUDED_CONTRACT_STATUSES: readonly ContractStatus[] = [
  ContractStatus.TERMINATED,
  ContractStatus.CLOSED_BAD_DEBT,
  ContractStatus.COMPLETED,
  ContractStatus.EARLY_PAYOFF,
  ContractStatus.EXCHANGED,
  ContractStatus.DEFECT_EXCHANGED,
];

export function isAccrualExcludedStatus(status: ContractStatus): boolean {
  return ACCRUAL_EXCLUDED_CONTRACT_STATUSES.includes(status);
}

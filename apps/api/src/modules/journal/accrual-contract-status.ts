import { ContractStatus } from '@prisma/client';

/**
 * สถานะสัญญาที่รอบตั้งลูกหนี้งวด (2A) ไม่ดูแล — สัญญาถูกบอกเลิก / ตัดหนี้สูญ / ผ่อนครบ /
 * ปิดยอดก่อนกำหนด / เปลี่ยนเครื่องไปแล้ว · สัญญาร่าง (DRAFT — ยังไม่เปิดใช้ จึงไม่มีรายการเปิดสัญญา 1A)
 * · สัญญาที่ถูกยกเลิก (CANCELED — รายการของสัญญาถูกย้อนกลับแล้ว). สองสถานะหลังไม่มีลูกหนี้ให้ตั้ง
 * ดอกเบี้ย/ภาษีขาย — 2A ของสัญญาแบบนี้จะรับรู้ Cr 41-1101 / 21-2101 บนสัญญาที่ไม่มีลูกหนี้.
 *
 * แหล่งเดียว (คำตัดสินผู้คุมงาน R1, 2026-09-29): รอบกลางคืน (installment-accrual.cron.ts) และ
 * การตั้งลูกหนี้งวด ณ วันรับเงิน (decideAccrueAtReceipt — ใช้ร่วมกันโดย PaymentReceiptTemplate และ
 * preview) ใช้รายการนี้ตัวเดียวกัน — ห้ามมีสำเนา.
 */
export const ACCRUAL_EXCLUDED_CONTRACT_STATUSES: readonly ContractStatus[] = [
  ContractStatus.TERMINATED,
  ContractStatus.CLOSED_BAD_DEBT,
  ContractStatus.COMPLETED,
  ContractStatus.EARLY_PAYOFF,
  ContractStatus.EXCHANGED,
  ContractStatus.DEFECT_EXCHANGED,
  ContractStatus.DRAFT,
  ContractStatus.CANCELED,
];

export function isAccrualExcludedStatus(status: ContractStatus): boolean {
  return ACCRUAL_EXCLUDED_CONTRACT_STATUSES.includes(status);
}

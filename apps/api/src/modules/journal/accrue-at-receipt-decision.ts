import { ContractStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { isAccrualExcludedStatus } from './accrual-contract-status';

/**
 * ผลการตัดสินว่าใบรับชำระใบหนึ่งต้องตั้งลูกหนี้งวด (2A) ก่อนลงใบรับชำระหรือไม่:
 *   ACCRUE              — ใบนี้ทำให้งวดชำระครบ → ตั้งส่วนที่เหลือของงวด (งวดที่ยังไม่เคยตั้ง = ทั้งงวด)
 *   ACCRUE_RECEIVED     — ใบบางส่วนก่อนวันครบกำหนด → ตั้งเท่ายอดที่ใบนี้ล้างลูกหนี้ของงวด
 *                         (คำตอบฝ่ายบัญชี ก1 "แบบ ข" 29/09/2569)
 *   ALREADY_ACCRUED     — งวดตั้งลูกหนี้ครบแล้ว ไม่ต้องทำอะไร
 *   CONTRACT_NOT_SERVED — สถานะสัญญาก่อนรับเงินอยู่ใน ACCRUAL_EXCLUDED_CONTRACT_STATUSES
 *                         (พฤติกรรมเดิม + สัญญาณเตือน)
 *   PARTIAL_RECEIPT     — ใบบางส่วนที่ไม่ลง 2A: ถึงวันครบกำหนดแล้ว ณ วันรับเงิน (รอบกลางคืนตั้งส่วนที่เหลือ)
 *                         หรือใบนี้ไม่ได้ล้างลูกหนี้ของงวดเลย
 */
export type AccrueAtReceiptDecision =
  | 'ACCRUE'
  | 'ACCRUE_RECEIVED'
  | 'ALREADY_ACCRUED'
  | 'CONTRACT_NOT_SERVED'
  | 'PARTIAL_RECEIPT';

export interface AccrueAtReceiptFacts {
  /** งวดตั้งลูกหนี้ครบแล้ว (accrualJournalEntryId มีค่า) */
  alreadyAccrued: boolean;
  /** สถานะของสัญญาก่อนการรับเงินครั้งนี้ (ไม่ใช่สถานะหลังเส้นทางรับชำระปิดสัญญา) */
  contractStatusBeforeReceipt: ContractStatus;
  /** ผู้เรียกบอกว่าใบนี้ทำให้แถว Payment ของงวดเป็น PAID */
  isFinalReceipt: boolean;
  /** splitReceipt().principalRemainingAfter — ยอดลูกหนี้ของงวดที่ยังเหลือในบัญชีหลังใบนี้ */
  principalRemainingAfter: Decimal;
  /** splitReceipt().principalCleared — ยอดที่ใบนี้เครดิต 11-2103 ของงวด */
  principalCleared: Decimal;
  /** วันครบกำหนดถึงแล้ว ณ วันที่รับเงิน (isDueDateReached — วันครบกำหนดเอง = ถึงแล้ว) */
  dueDateReached: boolean;
}

/**
 * กติกาเดียวของ "ตั้งลูกหนี้งวด ณ วันรับเงิน" (คำตัดสินฝ่ายบัญชี D2 + ก1 · คำตัดสินผู้คุมงาน R1, R9, R12,
 * B1) — ใช้ร่วมกันโดย PaymentReceiptTemplate (ลงจริง) และ PaymentJournalPreviewService (แสดงก่อนบันทึก).
 *
 * ลำดับการตัดสิน (ข้อแรกที่เป็นจริงชนะ):
 *   1. งวดตั้งครบแล้ว → ALREADY_ACCRUED
 *   2. สถานะก่อนรับเงินเป็นสถานะที่รอบกลางคืนไม่ดูแล → CONTRACT_NOT_SERVED
 *   3. ใบนี้ทำให้งวดชำระครบ (ลูกหนี้ของงวดในบัญชีเป็นศูนย์หลังใบนี้ **และ** ใบนี้ทำให้แถวงวดเป็น PAID)
 *      → ACCRUE ไม่ว่าจะถึงวันครบกำหนดแล้วหรือยัง (วันที่ลงตัดสินที่ resolveAccrualPostingDate)
 *   4. ถึงวันครบกำหนดแล้ว ณ วันรับเงิน หรือใบนี้ไม่ได้ล้างลูกหนี้ของงวด → PARTIAL_RECEIPT
 *   5. นอกนั้น → ACCRUE_RECEIVED (ยอด = principalCleared)
 * ห้ามตัดสินจาก Payment.status, ยอดเรียกเก็บ หรือ delta.
 */
export function decideAccrueAtReceipt(facts: AccrueAtReceiptFacts): AccrueAtReceiptDecision {
  if (facts.alreadyAccrued) return 'ALREADY_ACCRUED';
  if (isAccrualExcludedStatus(facts.contractStatusBeforeReceipt)) return 'CONTRACT_NOT_SERVED';
  if (facts.isFinalReceipt && facts.principalRemainingAfter.isZero()) return 'ACCRUE';
  if (facts.dueDateReached || facts.principalCleared.lte(0)) return 'PARTIAL_RECEIPT';
  return 'ACCRUE_RECEIVED';
}

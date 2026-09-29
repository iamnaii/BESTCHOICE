import { ContractStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { isAccrualExcludedStatus } from './accrual-contract-status';

/**
 * ผลการตัดสินว่าใบรับชำระใบหนึ่งต้องตั้งลูกหนี้งวด (2A) ก่อนลงใบรับชำระหรือไม่:
 *   ACCRUE              — ตั้งลูกหนี้งวด ณ วันรับเงิน
 *   ALREADY_ACCRUED     — งวดมีรายการ 2A แล้ว ไม่ต้องทำอะไร
 *   CONTRACT_NOT_SERVED — สถานะสัญญาก่อนรับเงินเป็นสถานะที่รอบกลางคืนไม่ดูแล (พฤติกรรมเดิม + สัญญาณเตือน)
 *   PARTIAL_RECEIPT     — ใบนี้ยังไม่ทำให้งวดชำระครบ (พฤติกรรมเดิม + สัญญาณเตือน)
 */
export type AccrueAtReceiptDecision =
  | 'ACCRUE'
  | 'ALREADY_ACCRUED'
  | 'CONTRACT_NOT_SERVED'
  | 'PARTIAL_RECEIPT';

export interface AccrueAtReceiptFacts {
  /** งวดมี accrualJournalEntryId แล้ว */
  alreadyAccrued: boolean;
  /** สถานะของสัญญาก่อนการรับเงินครั้งนี้ (ไม่ใช่สถานะหลังเส้นทางรับชำระปิดสัญญา) */
  contractStatusBeforeReceipt: ContractStatus;
  /** ผู้เรียกบอกว่าใบนี้ทำให้แถว Payment ของงวดเป็น PAID */
  isFinalReceipt: boolean;
  /** splitReceipt().principalRemainingAfter — ยอดลูกหนี้ของงวดที่ยังเหลือในบัญชีหลังใบนี้ */
  principalRemainingAfter: Decimal;
}

/**
 * กติกาเดียวของ "ตั้งลูกหนี้งวด ณ วันรับเงิน" (คำตัดสินฝ่ายบัญชี D2 + คำตัดสินผู้คุมงาน R1, R9, R12) —
 * ใช้ร่วมกันโดย PaymentReceiptTemplate (ลงจริง) และ PaymentJournalPreviewService (แสดงก่อนบันทึก).
 *
 * ตั้งเฉพาะเมื่อใบนี้ทำให้งวดชำระครบ: ลูกหนี้ของงวดในบัญชีเป็นศูนย์หลังใบนี้ **และ** ใบนี้ทำให้แถวงวด
 * เป็น PAID. ต้องจริงทั้งสองข้อ — ใบที่ล้างลูกหนี้ในบัญชีครบแต่แถวงวดยังค้างเศษของยอดเรียกเก็บ
 * (เรียกเก็บ 6,079.00 บัญชี 6,078.67 รับ 6,078.67 แบบบางส่วน) ถือเป็นการรับบางส่วน.
 * ห้ามตัดสินจาก Payment.status, ยอดเรียกเก็บ, delta หรือ principalCleared.
 *
 * การรับบางส่วนของงวดที่ยังไม่มี 2A คงพฤติกรรมเดิม — ฝ่ายบัญชีตอบ 29/09/2569 ให้ตั้งลูกหนี้งวด
 * เท่ายอดที่รับ ส่วนที่เหลือตั้ง ณ วันครบกำหนด ซึ่งเจ้าของสั่งแยกเป็นงานถัดไป.
 */
export function decideAccrueAtReceipt(facts: AccrueAtReceiptFacts): AccrueAtReceiptDecision {
  if (facts.alreadyAccrued) return 'ALREADY_ACCRUED';
  if (isAccrualExcludedStatus(facts.contractStatusBeforeReceipt)) return 'CONTRACT_NOT_SERVED';
  if (!facts.isFinalReceipt || !facts.principalRemainingAfter.isZero()) return 'PARTIAL_RECEIPT';
  return 'ACCRUE';
}

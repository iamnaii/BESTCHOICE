import { BadRequestException } from '@nestjs/common';

// Max days in the future a PROMISED settlementDate can be set.
// Hard cap shared by recordSettlement, logContact (PROMISED), and
// partialPaymentReschedule. Reasoning:
//  - aging buckets stay accurate (no 6-month "ghost" promises)
//  - promise tab filter (queue.service now+30d) keeps everything visible
//  - matches the documented anti-fraud rule on recordSettlement
export const PROMISED_MAX_DAYS = 30;

/**
 * User-facing Thai messages for the three settlement-date guards.
 * recordSettlement + logContact use "วันนัดชำระ"; partialPaymentReschedule
 * uses "วันที่นัดจ่าย" — same validation, different wording, preserved verbatim.
 */
interface SettlementDateMessages {
  invalid: string;
  notFuture: string;
  tooFar: string;
}

const DEFAULT_MESSAGES: SettlementDateMessages = {
  invalid: 'วันนัดชำระไม่ถูกต้อง',
  notFuture: 'วันนัดชำระต้องเป็นวันในอนาคต',
  tooFar: `วันนัดชำระห่างจากวันนี้เกิน ${PROMISED_MAX_DAYS} วัน — กรุณาติดต่อหัวหน้างาน`,
};

/**
 * Validate a PROMISED settlement date against the 30-day forward cap.
 * Throws BadRequestException with the (optionally overridden) Thai message.
 * Behaviour is identical to the three inline blocks it replaces:
 *   1. isNaN(date)            -> invalid
 *   2. date <= now            -> notFuture
 *   3. date >  now + 30 days  -> tooFar
 */
export function validateSettlementDate(
  date: Date,
  now: Date,
  messages: SettlementDateMessages = DEFAULT_MESSAGES,
): void {
  const maxDate = new Date(now.getTime() + PROMISED_MAX_DAYS * 24 * 60 * 60 * 1000);
  if (isNaN(date.getTime())) {
    throw new BadRequestException(messages.invalid);
  }
  if (date.getTime() <= now.getTime()) {
    throw new BadRequestException(messages.notFuture);
  }
  if (date.getTime() > maxDate.getTime()) {
    throw new BadRequestException(messages.tooFar);
  }
}

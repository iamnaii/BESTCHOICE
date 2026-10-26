import { IsString, Length } from 'class-validator';
import { RECURRING_BILL_SKIP_REASON } from '@installment/shared';

export class SkipOccurrenceDto {
  @IsString()
  @Length(RECURRING_BILL_SKIP_REASON.min, RECURRING_BILL_SKIP_REASON.max, {
    message: `เหตุผลต้องยาว ${RECURRING_BILL_SKIP_REASON.min}-${RECURRING_BILL_SKIP_REASON.max} ตัวอักษร`,
  })
  reason!: string;
}

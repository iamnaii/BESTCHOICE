import { IsIn, IsOptional, IsString, IsDateString, MaxLength } from 'class-validator';

// P1 Task 12 — quick-tag enums captured from ContactLogDialog chips.
// Keep values 1:1 with prisma `CallResult` and `NegotiationResult` enums.
export const CALL_RESULT_VALUES = [
  'ANSWERED',
  'NO_ANSWER',
  'BUSY',
  'DEVICE_OFF',
  'UNREACHABLE',
] as const;
export type CallResultTag = (typeof CALL_RESULT_VALUES)[number];

export const NEGOTIATION_RESULT_VALUES = [
  'REQUESTED_EXTENSION',
  'WILL_PAY',
  'REFUSED',
  'REQUESTED_RETURN',
  'NEGOTIATING',
  'NOT_APPLICABLE',
] as const;
export type NegotiationResultTag = (typeof NEGOTIATION_RESULT_VALUES)[number];

export class LogContactDto {
  @IsIn(['NO_ANSWER', 'ANSWERED', 'PROMISED', 'REFUSED', 'WRONG_NUMBER', 'OTHER'], {
    message: 'result ไม่ถูกต้อง',
  })
  result!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  collectionNotes?: string; // อัปเดต collectionNotes บน Contract ด้วย

  @IsOptional()
  @IsDateString({}, { message: 'settlementDate ต้องเป็นวันที่ ISO' })
  settlementDate?: string;

  @IsOptional()
  @IsString()
  settlementNotes?: string;

  // Quick-tag enum fields (Task 12). Optional for back-compat — older clients
  // and the existing free-string `result` continue to work unchanged.
  @IsOptional()
  @IsIn(CALL_RESULT_VALUES, { message: 'callResult ไม่ถูกต้อง' })
  callResult?: CallResultTag;

  @IsOptional()
  @IsIn(NEGOTIATION_RESULT_VALUES, { message: 'negotiationResult ไม่ถูกต้อง' })
  negotiationResult?: NegotiationResultTag;
}

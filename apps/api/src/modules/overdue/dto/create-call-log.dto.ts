import { IsString, IsOptional, IsDateString, Matches, MaxLength } from 'class-validator';

export class CreateCallLogDto {
  @IsString()
  contractId: string;

  @IsDateString({}, { message: 'calledAt ต้องเป็นรูปแบบวันที่ที่ถูกต้อง' })
  calledAt: string;

  @IsString()
  @Matches(/^(ANSWERED|NO_ANSWER|PROMISED|REFUSED)$/, { message: 'result ต้องเป็น ANSWERED, NO_ANSWER, PROMISED หรือ REFUSED' })
  result: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'หมายเหตุต้องไม่เกิน 2000 ตัวอักษร' })
  notes?: string;
}

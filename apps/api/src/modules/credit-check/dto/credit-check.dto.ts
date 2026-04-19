import { IsString, IsOptional, IsArray, IsNumber, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCreditCheckDto {
  @IsString()
  @IsOptional()
  bankName?: string;

  @IsArray()
  @IsString({ each: true })
  statementFiles: string[]; // base64 encoded file URLs

  @IsNumber()
  @IsOptional()
  statementMonths?: number;
}

export class OverrideCreditCheckDto {
  @IsString()
  @Matches(/^(APPROVED|REJECTED|MANUAL_REVIEW)$/, { message: 'status ต้องเป็น APPROVED, REJECTED หรือ MANUAL_REVIEW' })
  status: string;

  @IsString({ message: 'ต้องระบุเหตุผลการเปลี่ยนผลตรวจเครดิต' })
  @MinLength(10, { message: 'เหตุผลต้องมีอย่างน้อย 10 ตัวอักษร' })
  @MaxLength(2000, { message: 'เหตุผลต้องไม่เกิน 2000 ตัวอักษร' })
  overrideReason!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'หมายเหตุต้องไม่เกิน 2000 ตัวอักษร' })
  reviewNotes?: string;
}

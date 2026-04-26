import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsBoolean,
  ArrayNotEmpty,
  IsNotEmpty,
  Matches,
} from 'class-validator';

export class SlipUploadBodyDto {
  @IsString({ message: 'กรุณาระบุ token' })
  @IsNotEmpty({ message: 'กรุณาระบุ token' })
  token!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'จำนวนเงินต้องเป็นตัวเลขทศนิยมที่ถูกต้อง' })
  amount?: string;
}

export class ApproveEvidenceDto {
  @IsNumber({}, { message: 'กรุณาระบุงวดที่' })
  installmentNo!: number;

  @IsNumber({}, { message: 'กรุณาระบุจำนวนเงิน' })
  amount!: number;

  @IsString({ message: 'กรุณาระบุวิธีชำระเงิน' })
  @IsNotEmpty({ message: 'กรุณาระบุวิธีชำระเงิน' })
  paymentMethod!: string;

  @IsOptional()
  @IsString()
  reviewNote?: string;

  /**
   * Explicit override flag — required when slip amount differs from
   * expected installment amount by more than the tolerance window.
   * Without this flag the controller now rejects the approval rather
   * than silently approving on a mismatch.
   */
  @IsOptional()
  @IsBoolean()
  acceptMismatch?: boolean;
}

export class BatchApproveEvidenceDto {
  @IsArray({ message: 'ids ต้องเป็น array' })
  @ArrayNotEmpty({ message: 'กรุณาเลือกรายการ' })
  @IsString({ each: true })
  ids!: string[];

  @IsString({ message: 'กรุณาระบุวิธีชำระเงิน' })
  @IsNotEmpty({ message: 'กรุณาระบุวิธีชำระเงิน' })
  paymentMethod!: string;
}

export class BatchRejectEvidenceDto {
  @IsArray({ message: 'ids ต้องเป็น array' })
  @ArrayNotEmpty({ message: 'กรุณาเลือกรายการ' })
  @IsString({ each: true })
  ids!: string[];

  @IsOptional()
  @IsString()
  reviewNote?: string;
}

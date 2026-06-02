import { IsString, IsNotEmpty, MinLength, IsOptional, MaxLength } from 'class-validator';

export class ReverseDisposalDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;

  /** Structured reverse reason (see ReverseAssetDto) — optional, backward compatible. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reasonLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

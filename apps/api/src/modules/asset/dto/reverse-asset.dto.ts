import { IsString, IsNotEmpty, MinLength, IsOptional, MaxLength } from 'class-validator';

export class ReverseAssetDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;

  /**
   * Structured reverse reason carried by the shared InternalControlActionBar
   * (`onReverse({ reasonId, reasonLabel, note })`). Optional + backward
   * compatible: legacy callers send only `reason`. When present they are
   * stamped into the AuditLog so the timeline renders the admin-managed label +
   * free-text note separately (mirrors Other Income / Expense).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reasonLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

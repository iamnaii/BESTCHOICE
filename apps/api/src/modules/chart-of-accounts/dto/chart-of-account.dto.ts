import { IsString, IsOptional, IsBoolean, Matches, MaxLength } from 'class-validator';

export class CreateChartOfAccountDto {
  // 2026-08-07 (review fix) — เดิม /^[0-9-]{2,12}$/ (ยุค A.4 ผัง FINANCE เดียว)
  // reject รหัสผัง SHOP ทั้งหมด → กดเพิ่มบัญชีจากแท็บ SHOP 400 เสมอ.
  // รูปแบบเดียวกับ csv-fixture-loader (^S?\d{2}-\d{4}$): S = SHOP partition (P3-SP5).
  @IsString()
  @Matches(/^S?\d{2}-\d{4}$/, {
    message: 'รหัสบัญชีต้องเป็นรูปแบบ XX-XXXX (FINANCE) หรือ SXX-XXXX (SHOP)',
  })
  code: string;

  @IsString()
  @MaxLength(200, { message: 'ชื่อบัญชียาวเกินไป' })
  name: string;

  @IsString()
  type: string; // สินทรัพย์ | หนี้สิน | ทุน | รายได้ | ค่าใช้จ่าย | สินทรัพย์ (Contra)

  @IsString()
  normalBalance: string; // Dr | Cr | Dr/Cr

  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @IsBoolean()
  @IsOptional()
  vatApplicable?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  status?: string; // ใช้งาน | ไม่ใช้งาน
}

export class UpdateChartOfAccountDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  normalBalance?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @IsBoolean()
  @IsOptional()
  vatApplicable?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  status?: string;
}

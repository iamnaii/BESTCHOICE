import { IsString, IsOptional, IsBoolean, Matches, MaxLength } from 'class-validator';

export class CreateChartOfAccountDto {
  @IsString()
  @Matches(/^[0-9-]{2,12}$/, { message: 'รหัสบัญชีต้องเป็นตัวเลขและขีดเท่านั้น' })
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

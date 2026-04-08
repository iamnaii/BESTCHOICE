import { IsString, IsOptional, IsEnum, IsBoolean, IsInt, Matches, MaxLength, Min, Max, IsArray, IsIn } from 'class-validator';
import { AccountGroup } from '@prisma/client';

const ALLOWED_COMPANY_CODES = ['SHOP', 'FINANCE'] as const;

export class CreateChartOfAccountDto {
  @IsString()
  @Matches(/^[0-9-]{2,12}$/, { message: 'รหัสบัญชีต้องเป็นตัวเลขและขีดเท่านั้น' })
  code: string;

  @IsString()
  @MaxLength(200, { message: 'ชื่อบัญชียาวเกินไป' })
  nameTh: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  nameEn?: string;

  @IsEnum(AccountGroup, { message: 'หมวดบัญชีไม่ถูกต้อง' })
  accountGroup: AccountGroup;

  @IsString()
  @IsOptional()
  parentCode?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  level?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsOptional()
  @IsIn(ALLOWED_COMPANY_CODES, { each: true, message: 'allowedCompanies ต้องเป็น SHOP หรือ FINANCE' })
  allowedCompanies?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(50)
  peakAccountCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  peakAccountId?: string;
}

export class UpdateChartOfAccountDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  nameTh?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  nameEn?: string;

  @IsEnum(AccountGroup)
  @IsOptional()
  accountGroup?: AccountGroup;

  @IsString()
  @IsOptional()
  parentCode?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  level?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsOptional()
  @IsIn(ALLOWED_COMPANY_CODES, { each: true, message: 'allowedCompanies ต้องเป็น SHOP หรือ FINANCE' })
  allowedCompanies?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(50)
  peakAccountCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  peakAccountId?: string;
}

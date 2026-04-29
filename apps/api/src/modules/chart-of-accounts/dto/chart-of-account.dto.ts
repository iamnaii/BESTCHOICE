import { IsString, IsOptional, IsEnum, IsBoolean, IsInt, Matches, MaxLength, Min, Max, IsUUID } from 'class-validator';
import { AccountGroup } from '@prisma/client';

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

  @IsUUID(undefined, { message: 'companyId ต้องเป็น UUID ที่ถูกต้อง' })
  @IsOptional()
  companyId?: string;

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

  // companyId kept for symmetry with CreateDto, but service.update() ignores it.
  // Moving an account between companies must be done via delete+recreate to preserve audit trail.
  @IsUUID(undefined, { message: 'companyId ต้องเป็น UUID ที่ถูกต้อง' })
  @IsOptional()
  companyId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  peakAccountCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  peakAccountId?: string;
}

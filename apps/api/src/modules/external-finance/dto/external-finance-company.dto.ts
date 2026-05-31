import { IsString, IsOptional, IsNumber, Min, Max, IsBoolean, IsObject, IsEmail, MaxLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateExternalFinanceCompanyDto {
  @IsString({ message: 'กรุณาระบุชื่อไฟแนนซ์' })
  name!: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  defaultCommissionRate?: number;

  @IsOptional()
  @IsObject()
  bankAccountInfo?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'เลขผู้เสียภาษีต้องไม่เกิน 20 ตัวอักษร' })
  taxId?: string;

  @IsOptional()
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lineOaId?: string;

  @IsOptional()
  @IsNumber({}, { message: 'เครดิตเทอมต้องเป็นตัวเลข' })
  @Min(0)
  creditTermDays?: number;
}

export class UpdateExternalFinanceCompanyDto extends PartialType(CreateExternalFinanceCompanyDto) {}

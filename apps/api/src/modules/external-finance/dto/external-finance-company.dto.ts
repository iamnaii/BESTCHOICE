import { IsString, IsOptional, IsNumber, Min, Max, IsBoolean, IsObject } from 'class-validator';
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
}

export class UpdateExternalFinanceCompanyDto extends PartialType(CreateExternalFinanceCompanyDto) {}

import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class CreateEmployeeDto {
  @IsUUID(undefined, { message: 'กรุณาเลือกผู้ใช้ (พนักงาน)' })
  userId!: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsEnum(EmploymentType, { message: 'ประเภทการจ้างไม่ถูกต้อง' })
  employmentType?: EmploymentType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ฐานเงินเดือนต้องเป็นตัวเลข' })
  @Min(0, { message: 'ฐานเงินเดือนต้องไม่ติดลบ' })
  baseSalary?: number;

  @IsOptional()
  @IsBoolean()
  ssoEligible?: boolean;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  taxIdOverride?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

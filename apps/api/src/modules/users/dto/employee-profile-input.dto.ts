import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, IsDateString } from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class EmployeeProfileInputDto {
  @IsOptional() @IsString()
  position?: string;

  @IsOptional() @IsEnum(EmploymentType, { message: 'ประเภทการจ้างไม่ถูกต้อง' })
  employmentType?: EmploymentType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ฐานเงินเดือนต้องเป็นตัวเลข' })
  @Min(0, { message: 'ฐานเงินเดือนต้องไม่ติดลบ' })
  baseSalary?: number;

  @IsOptional() @IsBoolean()
  ssoEligible?: boolean;

  @IsOptional() @IsString()
  bankName?: string;

  @IsOptional() @IsString()
  bankAccountNo?: string;

  // null = ยกเลิกสถานะลาออก (กลับมาทำงาน); undefined = ไม่แตะ
  @IsOptional() @IsDateString()
  resignedDate?: string | null;
}

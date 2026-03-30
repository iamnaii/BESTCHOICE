import { IsString, IsOptional, IsInt, IsBoolean, IsEmail, Min } from 'class-validator';

export class CreateFinanceCompanyDto {
  @IsString({ message: 'กรุณาระบุชื่อบริษัทไฟแนนซ์' })
  name: string;

  @IsString()
  @IsOptional()
  shortName?: string;

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankAccount?: string;

  @IsInt({ message: 'เครดิตเทอมต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'เครดิตเทอมต้องมากกว่า 0' })
  @IsOptional()
  creditTerms?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateFinanceCompanyDto {
  @IsString({ message: 'กรุณาระบุชื่อบริษัทไฟแนนซ์' })
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  shortName?: string;

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankAccount?: string;

  @IsInt({ message: 'เครดิตเทอมต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'เครดิตเทอมต้องมากกว่า 0' })
  @IsOptional()
  creditTerms?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;
}

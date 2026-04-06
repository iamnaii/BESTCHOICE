import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsInt,
  IsIn,
} from 'class-validator';

export class CreatePromotionDto {
  @IsString({ message: 'กรุณาระบุชื่อโปรโมชัน' })
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString({ message: 'กรุณาระบุประเภทโปรโมชัน' })
  @IsIn(['PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT', 'FREE_ACCESSORY', 'SPECIAL_RATE'], {
    message: 'ประเภทโปรโมชันไม่ถูกต้อง',
  })
  type: string;

  @IsNumber({}, { message: 'ส่วนลดต้องเป็นตัวเลข' })
  @IsOptional()
  discountValue?: number;

  @IsNumber({}, { message: 'อัตราดอกเบี้ยพิเศษต้องเป็นตัวเลข' })
  @IsOptional()
  specialInterestRate?: number;

  @IsOptional()
  conditions?: Record<string, unknown>;

  @IsDateString({}, { message: 'กรุณาระบุวันที่เริ่มต้น' })
  startDate: string;

  @IsDateString({}, { message: 'กรุณาระบุวันที่สิ้นสุด' })
  endDate: string;

  @IsInt({ message: 'จำนวนครั้งใช้งานสูงสุดต้องเป็นจำนวนเต็ม' })
  @IsOptional()
  maxUsageCount?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdatePromotionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(['PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT', 'FREE_ACCESSORY', 'SPECIAL_RATE'], {
    message: 'ประเภทโปรโมชันไม่ถูกต้อง',
  })
  type?: string;

  @IsNumber({}, { message: 'ส่วนลดต้องเป็นตัวเลข' })
  @IsOptional()
  discountValue?: number;

  @IsNumber({}, { message: 'อัตราดอกเบี้ยพิเศษต้องเป็นตัวเลข' })
  @IsOptional()
  specialInterestRate?: number;

  @IsOptional()
  conditions?: Record<string, unknown>;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsInt({ message: 'จำนวนครั้งใช้งานสูงสุดต้องเป็นจำนวนเต็ม' })
  @IsOptional()
  maxUsageCount?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ApplyPromotionDto {
  @IsString({ message: 'กรุณาระบุรหัสการขาย' })
  saleId: string;

  @IsString({ message: 'กรุณาระบุรหัสลูกค้า' })
  customerId: string;

  @IsNumber({}, { message: 'จำนวนส่วนลดต้องเป็นตัวเลข' })
  discountAmount: number;
}

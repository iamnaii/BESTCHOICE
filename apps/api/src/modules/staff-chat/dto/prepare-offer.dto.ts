import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PrepareOfferDto {
  @IsOptional()
  @IsString({ message: 'กรุณาระบุรุ่นสินค้าเป็นข้อความ' })
  @MaxLength(120, { message: 'ระบุความต้องการได้ไม่เกิน 120 ตัวอักษร' })
  query?: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'กรุณาระบุงบเป็นตัวเลข' })
  @Min(1, { message: 'งบต้องมากกว่า 0 บาท' })
  @Max(1000000, { message: 'งบต้องไม่เกิน 1,000,000 บาท' })
  maxPriceThb?: number;

  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดต้องไม่น้อยกว่า 1' })
  @Max(60, { message: 'จำนวนงวดต้องไม่เกิน 60' })
  tenureMonths = 12;
}

import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreatePlanDto {
  @IsOptional() @IsUUID() targetProductId?: string;
  @IsOptional() @IsString() targetProductModel?: string;

  @IsInt({ message: 'เป้าหมายต้องเป็นจำนวนเต็ม' })
  @Min(1000, { message: 'เป้าหมายขั้นต่ำ 1,000 บาท' })
  targetAmount!: number;

  @IsInt({ message: 'ยอดรายเดือนต้องเป็นจำนวนเต็ม' })
  @Min(500, { message: 'ยอดรายเดือนขั้นต่ำ 500 บาท' })
  monthlyAmount!: number;

  @IsInt()
  @Min(2, { message: 'จำนวนงวดขั้นต่ำ 2 เดือน' })
  @Max(12, { message: 'จำนวนงวดสูงสุด 12 เดือน' })
  durationMonths!: number;
}

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBookingItemDto {
  @IsUUID(undefined, { message: 'กรุณาเลือกเครื่องในสต็อก' })
  productId!: string;

  @IsString({ message: 'description ต้องเป็น string' })
  description!: string;

  @IsInt({ message: 'quantity ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'quantity ต้องอย่างน้อย 1' })
  @Max(1, { message: 'จองได้เครื่องละ 1 ชิ้น' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'unitPrice ต้องเป็นตัวเลข' })
  @Min(0, { message: 'unitPrice ต้องไม่ติดลบ' })
  unitPrice!: number;
}

export class CreateBookingDto {
  @IsUUID(undefined, { message: 'กรุณาเลือกลูกค้า' })
  customerId!: string;

  @IsUUID(undefined, { message: 'กรุณาเลือกสาขา' })
  branchId!: string;

  @IsArray({ message: 'items ต้องเป็น array' })
  @ArrayMinSize(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' })
  @ArrayMaxSize(1, { message: 'ใบจองต้องผูกเครื่องในสต็อก 1 เครื่อง' })
  @ValidateNested({ each: true })
  @Type(() => CreateBookingItemDto)
  items!: CreateBookingItemDto[];

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'depositAmount ต้องเป็นตัวเลข' })
  @Min(0.01, { message: 'มัดจำต้องมากกว่า 0 บาท' })
  depositAmount!: number;

  /** Optional explicit expire date (ISO). If omitted, service defaults to
   *  now + `booking_expire_days` SystemConfig (default 7). */
  @IsOptional()
  @IsDateString({}, { message: 'expireDate ต้องเป็นวันที่' })
  expireDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

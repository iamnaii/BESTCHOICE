import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateBookingItemDto } from './create-booking.dto';

export class UpdateBookingDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'customerId ต้องเป็น UUID' })
  customerId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'branchId ต้องเป็น UUID' })
  branchId?: string;

  @IsOptional()
  @IsArray({ message: 'items ต้องเป็น array' })
  @ArrayMinSize(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' })
  @ArrayMaxSize(1, { message: 'ใบจองต้องผูกเครื่องในสต็อก 1 เครื่อง' })
  @ValidateNested({ each: true })
  @Type(() => CreateBookingItemDto)
  items?: CreateBookingItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'depositAmount ต้องเป็นตัวเลข' })
  @Min(0.01, { message: 'มัดจำต้องมากกว่า 0 บาท' })
  depositAmount?: number;

  @IsOptional()
  @IsDateString({}, { message: 'expireDate ต้องเป็นวันที่' })
  expireDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

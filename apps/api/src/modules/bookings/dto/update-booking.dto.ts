import {
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
  @ValidateNested({ each: true })
  @Type(() => CreateBookingItemDto)
  items?: CreateBookingItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'depositAmount ต้องเป็นตัวเลข' })
  @Min(0, { message: 'depositAmount ต้องไม่ติดลบ' })
  depositAmount?: number;

  @IsOptional()
  @IsDateString({}, { message: 'expireDate ต้องเป็นวันที่' })
  expireDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

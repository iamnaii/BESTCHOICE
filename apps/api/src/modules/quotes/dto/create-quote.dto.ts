import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateQuoteItemDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'productId ต้องเป็น UUID' })
  productId?: string;

  @IsString({ message: 'description ต้องเป็น string' })
  description!: string;

  @IsInt({ message: 'quantity ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'quantity ต้องอย่างน้อย 1' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'unitPrice ต้องเป็นตัวเลข' })
  @Min(0, { message: 'unitPrice ต้องไม่ติดลบ' })
  unitPrice!: number;
}

export class CreateQuoteDto {
  @IsUUID(undefined, { message: 'กรุณาเลือกลูกค้า' })
  customerId!: string;

  @IsUUID(undefined, { message: 'กรุณาเลือกสาขา' })
  branchId!: string;

  @IsDateString({}, { message: 'validUntil ต้องเป็นวันที่' })
  validUntil!: string;

  @IsArray({ message: 'items ต้องเป็น array' })
  @ArrayMinSize(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteItemDto)
  items!: CreateQuoteItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'discount ต้องเป็นตัวเลข' })
  @Min(0, { message: 'discount ต้องไม่ติดลบ' })
  discount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'vatAmount ต้องเป็นตัวเลข' })
  @Min(0, { message: 'vatAmount ต้องไม่ติดลบ' })
  vatAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

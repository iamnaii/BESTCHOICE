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
import { CreateQuoteItemDto } from './create-quote.dto';

export class UpdateQuoteDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'customerId ต้องเป็น UUID' })
  customerId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'branchId ต้องเป็น UUID' })
  branchId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'validUntil ต้องเป็นวันที่' })
  validUntil?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteItemDto)
  items?: CreateQuoteItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  vatAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

import { IsString, IsOptional, IsArray, ValidateNested, IsBoolean, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStockCountDto {
  @IsString()
  branchId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class StockCountItemDto {
  @IsString()
  productId: string;

  @IsBoolean()
  actualFound: boolean;

  @IsString()
  @IsOptional()
  conditionNotes?: string;

  @IsString()
  @IsOptional()
  scannedImei?: string;
}

export class SubmitStockCountDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockCountItemDto)
  items: StockCountItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}

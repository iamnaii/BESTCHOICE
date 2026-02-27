import { IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class POItemDto {
  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;
}

export class CreatePODto {
  @IsString()
  supplierId: string;

  @IsDateString()
  orderDate: string;

  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => POItemDto)
  items: POItemDto[];
}

export class UpdatePODto {
  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class ReceiveItemDto {
  @IsString()
  poItemId: string;

  @IsNumber()
  receivedQty: number;
}

export class ReceivePODto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];
}

// New goods receiving DTOs
export class GoodsReceivingItemDto {
  @IsString()
  poItemId: string;

  @IsString()
  @IsOptional()
  imeiSerial?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsArray()
  @IsOptional()
  photos?: string[];

  @IsEnum(['PASS', 'REJECT'])
  status: 'PASS' | 'REJECT';

  @IsString()
  @IsOptional()
  rejectReason?: string;
}

export class GoodsReceivingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceivingItemDto)
  items: GoodsReceivingItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}

import { IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested, IsIn, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class POItemDto {
  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  storage?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  accessoryType?: string;

  @IsString()
  @IsOptional()
  accessoryBrand?: string;

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

  @IsNumber()
  @IsOptional()
  discount?: number;

  @IsIn(['UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'FULLY_PAID'])
  @IsOptional()
  paymentStatus?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsNumber()
  @IsOptional()
  paidAmount?: number;

  @IsString()
  @IsOptional()
  paymentNotes?: string;

  @IsArray()
  @IsOptional()
  attachments?: string[];
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

export class UpdatePaymentDto {
  @IsIn(['UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'FULLY_PAID'])
  paymentStatus: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsNumber()
  paidAmount: number;

  @IsString()
  @IsOptional()
  paymentNotes?: string;

  @IsArray()
  @IsOptional()
  attachments?: string[];
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

  @IsIn(['PASS', 'REJECT'])
  status: 'PASS' | 'REJECT';

  @IsString()
  @IsOptional()
  rejectReason?: string;

  @IsNumber()
  @IsOptional()
  batteryHealth?: number;

  @IsBoolean()
  @IsOptional()
  warrantyExpired?: boolean;

  @IsString()
  @IsOptional()
  warrantyExpireDate?: string;

  @IsBoolean()
  @IsOptional()
  hasBox?: boolean;
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

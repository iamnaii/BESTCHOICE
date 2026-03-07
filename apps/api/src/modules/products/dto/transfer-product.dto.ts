import { IsString, IsOptional, IsDateString, IsArray, ArrayMinSize } from 'class-validator';

export class TransferProductDto {
  @IsString()
  toBranchId: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsDateString()
  @IsOptional()
  expectedDeliveryDate?: string;
}

export class BulkTransferDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  productIds: string[];

  @IsString()
  toBranchId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class DispatchTransferDto {
  @IsString()
  @IsOptional()
  trackingNote?: string;
}

import { IsString, IsOptional, IsDateString } from 'class-validator';

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

export class DispatchTransferDto {
  @IsString()
  @IsOptional()
  trackingNote?: string;
}

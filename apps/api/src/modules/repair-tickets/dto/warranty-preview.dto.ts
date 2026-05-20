import { IsOptional, IsUUID } from 'class-validator';

export class WarrantyPreviewDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;
}

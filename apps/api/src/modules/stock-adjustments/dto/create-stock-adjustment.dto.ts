import { IsString, IsOptional, IsArray, IsIn } from 'class-validator';

export class CreateStockAdjustmentDto {
  @IsString()
  productId: string;

  @IsIn(['DAMAGED', 'LOST', 'FOUND', 'CORRECTION', 'WRITE_OFF', 'OTHER'])
  reason: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  photos?: string[];
}

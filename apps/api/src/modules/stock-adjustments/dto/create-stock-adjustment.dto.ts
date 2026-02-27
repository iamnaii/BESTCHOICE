import { IsString, IsOptional, IsArray, IsIn, IsNotEmpty } from 'class-validator';

export class CreateStockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsIn(['DAMAGED', 'LOST', 'FOUND', 'CORRECTION', 'WRITE_OFF', 'OTHER'])
  reason: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photos?: string[];
}

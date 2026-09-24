import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class SwitchToRepairDto {
  @IsOptional()
  @IsIn(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM'], { message: 'ผู้จ่ายไม่ถูกต้อง' })
  payer?: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimatedCost?: number;

  @IsOptional()
  @IsUUID()
  repairSupplierId?: string;
}

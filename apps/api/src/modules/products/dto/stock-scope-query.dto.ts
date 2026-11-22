import { STOCK_INVENTORY_SCOPES, type StockInventoryScope } from '@installment/shared';
import { IsIn, IsOptional } from 'class-validator';

export class StockScopeQueryDto {
  @IsOptional()
  @IsIn(STOCK_INVENTORY_SCOPES, { message: 'หมวดสินค้าที่แสดงไม่ถูกต้อง' })
  inventoryScope?: StockInventoryScope;
}

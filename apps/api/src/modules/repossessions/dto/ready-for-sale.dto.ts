import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ReadyForSaleDto {
  @IsNotEmpty({ message: 'กรุณาระบุราคาขายต่อ' })
  @Type(() => Number)
  @IsNumber({}, { message: 'ราคาขายต่อต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคาขายต่อต้องไม่ติดลบ' })
  resellPrice: number;
}

import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ReadyForSaleDto {
  @IsNotEmpty({ message: 'กรุณาระบุราคาขายต่อ' })
  @Type(() => Number)
  @IsNumber({}, { message: 'ราคาขายต่อต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคาขายต่อต้องไม่ติดลบ' })
  resellPrice: number;

  /**
   * ราคาผ่อน BESTCHOICE (2026-09-07 — เจ้าของสั่งให้ "พร้อมขาย" ตั้งสองราคา): เครื่องยึดคืน
   * ยังถือราคาผ่อนตอนเป็นเครื่องใหม่อยู่ ถ้าไม่ทับ POS/บอทจะหยิบราคาเก่าไปขาย
   */
  @IsNotEmpty({ message: 'กรุณาระบุราคาผ่อน' })
  @Type(() => Number)
  @IsNumber({}, { message: 'ราคาผ่อนต้องเป็นตัวเลข' })
  @Min(0.01, { message: 'ราคาผ่อนต้องมากกว่า 0' })
  installmentPrice: number;
}

import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RoomMessageSearchDto {
  @IsString({ message: 'กรุณาระบุคำค้น' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2, { message: 'กรุณาพิมพ์อย่างน้อย 2 ตัวอักษร' })
  @MaxLength(200, { message: 'คำค้นต้องไม่เกิน 200 ตัวอักษร' })
  q!: string;

  @Type(() => Number)
  @IsInt({ message: 'เลขหน้าต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'เลขหน้าต้องเริ่มที่ 1' })
  @Max(10000, { message: 'เลขหน้ามากเกินไป กรุณาระบุคำค้นให้เจาะจงขึ้น' })
  page = 1;

  @Type(() => Number)
  @IsInt({ message: 'จำนวนรายการต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนรายการต้องไม่น้อยกว่า 1' })
  @Max(50, { message: 'แสดงได้ไม่เกิน 50 รายการต่อหน้า' })
  limit = 20;
}

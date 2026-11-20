import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/** ปิดราคาหลายช่องพร้อมกัน (ตอนนำเข้า: ราคาที่มีในระบบแต่ไม่มีในไฟล์ — สเปค 2026-11-20 §5, §6.3) */
export class CloseMaxPricesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'กรุณาเลือกราคาที่จะปิดอย่างน้อย 1 ช่อง' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

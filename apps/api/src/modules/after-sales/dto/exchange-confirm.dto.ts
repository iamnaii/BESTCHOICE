import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ExchangeConfirmDto {
  @IsOptional()
  @IsString()
  note?: string;

  /** ใช้เฉพาะเคส REPAIR ที่ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม — เคส SAME_MODEL_EXCHANGE ปกติมี
   * replacementProductId ติดมากับเคสตั้งแต่ตอนแจ้งปัญหาแล้ว ไม่ต้องส่งซ้ำ */
  @IsOptional()
  @IsUUID()
  replacementProductId?: string;
}

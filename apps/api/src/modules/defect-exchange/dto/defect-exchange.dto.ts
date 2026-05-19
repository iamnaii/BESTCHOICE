import { IsString, IsArray, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class ExecuteDefectExchangeDto {
  @IsString({ message: 'กรุณาระบุสัญญาเดิม' })
  oldContractId: string;

  @IsString({ message: 'กรุณาระบุสินค้าใหม่' })
  newProductId: string;

  @IsString({ message: 'กรุณาระบุอาการเครื่องเสีย' })
  defectReason: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photoUrls?: string[];

  @IsString()
  @IsOptional()
  notes?: string;

  /** ข้ามการตรวจสอบ 7 วัน — ต้องระบุ originRepairTicketId ด้วย */
  @IsOptional()
  @IsBoolean()
  bypassWindowCheck?: boolean;

  /** Repair ticket ที่เป็นต้นเหตุ (ใช้คู่กับ bypassWindowCheck=true) */
  @IsOptional()
  @IsUUID('4')
  originRepairTicketId?: string;
}

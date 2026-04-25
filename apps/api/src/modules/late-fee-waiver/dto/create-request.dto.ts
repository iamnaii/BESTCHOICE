import { ArrayMinSize, IsArray, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateLateFeeWaiverDto {
  @IsUUID('4', { message: 'contractId ไม่ถูกต้อง' })
  contractId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'กรุณาเลือกอย่างน้อย 1 งวดที่ต้องการขอ waive ค่าปรับ' })
  @IsUUID('4', { each: true, message: 'paymentId แต่ละรายการต้องเป็น UUID' })
  paymentIds!: string[];

  @IsString()
  @MinLength(5, { message: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร' })
  reason!: string;
}

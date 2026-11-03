import { IsNotEmpty, IsString, IsNumber, IsOptional, MaxLength, Min } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsNotEmpty({ message: 'กรุณาระบุรหัสสัญญา' })
  @IsString()
  contractId: string;

  @IsNotEmpty({ message: 'กรุณาระบุจำนวนเงิน' })
  @IsNumber({}, { message: 'จำนวนเงินต้องเป็นตัวเลข' })
  @Min(1, { message: 'จำนวนเงินต้องมากกว่า 0' })
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  lineId?: string;

  @IsOptional()
  @IsNumber()
  installmentNo?: number;

  /**
   * Task 39 — token ของลิงก์ชำระที่ไม่ผูกงวด (หน้า `/pay/:token` ส่งแทน `installmentNo`) ⇒ server ใช้ยอดของลิงก์ที่เก็บไว้
   * (ยอดใน body ต้องตรง ±0.01) · ส่งมาพร้อม `installmentNo` = ไม่ใช้ (ทางผูกงวดเดิม)
   */
  @IsOptional()
  @IsString({ message: 'ลิงก์ชำระเงินไม่ถูกต้อง' })
  @MaxLength(128, { message: 'ลิงก์ชำระเงินไม่ถูกต้อง' })
  paymentLinkToken?: string;
}

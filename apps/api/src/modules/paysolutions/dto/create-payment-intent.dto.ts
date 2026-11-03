import { IsNotEmpty, IsString, IsNumber, IsOptional, Matches, Min } from 'class-validator';
import { PAY_LINK_TOKEN_PATTERN } from '../pay-link-token';

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
   * Task 39 — token ของลิงก์ `/pay/:token` ที่ไม่ใช่ `INSTALLMENT` (หน้าเว็บส่งแทน `installmentNo`) ⇒ server ใช้ยอดของลิงก์ที่เก็บไว้
   * (ยอดใน body ต้องตรง ±0.01) · รับเฉพาะ 64 hex ของ `createPaymentLink` (ไม่ใช่เลขอ้างอิงของแถวติดตาม intent — รีวิว m-2) ·
   * ส่งมาพร้อม `installmentNo` = ไม่ใช้ (ทางเลขงวดเดิม)
   */
  @IsOptional()
  @IsString({ message: 'ลิงก์ชำระเงินไม่ถูกต้อง' })
  @Matches(PAY_LINK_TOKEN_PATTERN, { message: 'ลิงก์ชำระเงินไม่ถูกต้อง' })
  paymentLinkToken?: string;
}

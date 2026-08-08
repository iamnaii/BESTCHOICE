import { IsIn, IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

/**
 * Task 2 (คำสั่งเจ้าของ 2026-08-08 ข้อ 2) — POST /repossessions/:id/refund-payment
 * body. Pays out the Cr 21-1107 liability JP5 parked at repossession time.
 */
export class RefundPaymentDto {
  @IsIn(CASH_ACCOUNT_CODES, {
    message: `บัญชีจ่ายเงินต้องเป็นหนึ่งใน ${CASH_ACCOUNT_CODES.join(', ')}`,
  })
  depositAccountCode: string;

  @IsNumber({}, { message: 'กรุณาระบุจำนวนเงิน' })
  @IsPositive({ message: 'จำนวนเงินต้องมากกว่า 0' })
  amount: number;

  /** Client-generated UUID ต่อการกดยืนยันหนึ่งครั้ง — dedupe retry โดยไม่กลืนการจ่ายซ้ำที่ตั้งใจ. */
  @IsUUID(4, { message: 'requestId ไม่ถูกต้อง' })
  @IsOptional()
  requestId?: string;
}

/**
 * คำสั่งเจ้าของ 2026-08-08 เพิ่มเติม — POST /repossessions/:id/refund-waive body.
 * ล้างยอด 21-1107 คงเหลือทั้งหมดเข้ารายได้จากการยึด (41-1102) — ไม่มี amount input,
 * เคลียร์ทั้งยอดคงเหลือเสมอ.
 */
export class RefundWaiveDto {
  /** Client-generated UUID ต่อการกดยืนยันหนึ่งครั้ง — dedupe retry โดยไม่กลืนการยกเลิกซ้ำที่ตั้งใจ. */
  @IsUUID(4, { message: 'requestId ไม่ถูกต้อง' })
  @IsOptional()
  requestId?: string;
}

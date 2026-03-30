import { IsString, IsOptional, IsDateString, IsNumberString, IsEnum } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class RecordFinanceReceiptDto {
  @IsNumberString({}, { message: 'กรุณาระบุจำนวนเงิน' })
  amount: string;

  @IsDateString({}, { message: 'รูปแบบวันที่ชำระไม่ถูกต้อง' })
  paymentDate: string;

  @IsEnum(PaymentMethod, { message: 'วิธีการชำระเงินไม่ถูกต้อง' })
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  evidenceUrl?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

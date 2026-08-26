import { IsString, IsOptional, IsNumber, IsEnum, IsDateString, Min, Max, Matches } from 'class-validator';
import { FinanceReceivableStatus } from '@prisma/client';

export class RecordReceiveDto {
  @IsNumber()
  @Min(0.01)
  receivedAmount: number;

  @IsDateString()
  receivedDate: string;

  @IsOptional()
  @IsString()
  bankRef?: string;

  @IsOptional()
  @IsString()
  note?: string;

  /**
   * บัญชีฝั่ง SHOP ที่เงินเข้าจริง (ต้องขึ้นต้น S) — ไม่ระบุ = S11-1201 ธนาคารรับเงินหน้าร้าน
   * ใช้เป็นขา Dr ของ JE ตอนไฟแนนซ์ภายนอกโอนเงินมา
   */
  @IsOptional()
  @IsString()
  @Matches(/^S\d{2}-\d{4}$/, { message: 'บัญชีเงินเข้าต้องเป็นรหัสฝั่งหน้าร้าน เช่น S11-1201' })
  depositAccountCode?: string;
}

export class UpdateFinanceReceivableDto {
  @IsOptional()
  @IsString()
  financeRefNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  // commissionRate is a fraction (0..1) — service recomputes
  // commissionAmount = expectedAmount * rate. Without @Max(1) a rate > 1 makes
  // commissionAmount exceed expectedAmount and netExpectedAmount go NEGATIVE
  // (an impossible receivable written straight to the books).
  @Max(1)
  commissionRate?: number;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsEnum(FinanceReceivableStatus)
  status?: FinanceReceivableStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * "บันทึกชำระเงิน" (Record Payment) — รองรับทั้ง full + partial payment.
 *
 * พฤติกรรม:
 *   - amountPaid = outstanding → full payment, **ไม่ต้องระบุ** newSettlementDate
 *     (autoAllocate ปิดสัญญา, journal/receipt/LINE auto)
 *   - amountPaid < outstanding → partial payment, **ต้องระบุ** newSettlementDate
 *     (autoAllocate กระจายเงินเข้างวดที่ค้าง + สร้าง CallLog PROMISED ใหม่ส่วนที่เหลือ)
 *   - amountPaid > outstanding → reject (over-payment ไม่รองรับใน flow นี้)
 */
export class PartialPaymentRescheduleDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amountPaid ต้องเป็นตัวเลข' })
  @Min(0.01, { message: 'จำนวนเงินที่จ่ายต้องมากกว่า 0' })
  amountPaid!: number;

  @IsString()
  @Matches(/^(CASH|BANK_TRANSFER|QR_EWALLET)$/, {
    message: 'paymentMethod ต้องเป็น CASH, BANK_TRANSFER หรือ QR_EWALLET',
  })
  paymentMethod!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\/.+/, { message: 'evidenceUrl ต้องเป็น HTTPS URL' })
  evidenceUrl?: string;

  // Bank/PromptPay/credit-card reference. Required by the FE for non-cash
  // methods. Persisted on Payment.notes (Payment table has no dedicated
  // transactionRef column today) so finance reconciliation can match it
  // back against bank statements.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  transactionRef?: string;

  // Optional: required only when amountPaid < outstanding (partial pay).
  // ถ้า amountPaid = outstanding (จ่ายเต็ม) ไม่ต้องระบุ — service ตรวจ runtime.
  @IsOptional()
  @IsDateString({}, { message: 'newSettlementDate ต้องเป็นวันที่ ISO' })
  newSettlementDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

import {
  IsString,
  IsNumber,
  ValidateIf,
  IsOptional,
  IsPositive,
  Min,
  MaxLength,
} from 'class-validator';

export class AddPointsDto {
  @IsString()
  customerId: string;

  @IsNumber({}, { message: 'กรุณาระบุจำนวนแต้มที่ถูกต้อง' })
  @IsPositive({ message: 'จำนวนแต้มต้องมากกว่า 0' })
  amount: number;

  /** ON_TIME_PAYMENT | REFERRAL | MANUAL */
  @IsString({ message: 'กรุณาระบุที่มาของแต้ม' })
  source: string;

  @IsString()
  @IsOptional()
  referenceId?: string; // paymentId, referredCustomerId, etc.

  @IsString()
  @IsOptional()
  @MaxLength(255)
  note?: string;
}

export class RedeemPointsDto {
  @IsNumber({}, { message: 'กรุณาระบุจำนวนแต้มที่ถูกต้อง' })
  @IsPositive({ message: 'จำนวนแต้มต้องมากกว่า 0' })
  @Min(1)
  amount: number;

  @IsString({ message: 'กรุณาระบุเหตุผลการแลก' })
  @MaxLength(255)
  description: string;

  @IsString()
  @IsOptional()
  contractId?: string;

  /** Legacy POS field is an exact actual Sale-ID alias for managed verification.
   * It never authorizes a new debit or completed-Sale repricing. */
  @ValidateIf((dto: RedeemPointsDto) => !dto.saleId || dto.posTransactionId !== undefined)
  @IsString({ message: 'กรุณาระบุเลขที่ธุรกรรม POS' })
  @MaxLength(255)
  posTransactionId: string;

  /** Managed verification selects an actual Sale; the legacy field is an exact alias. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  saleId?: string;

  /**
   * T3-C3: OWNER override required when redeeming > 10,000 points in one
   * call in legacy mode only. Managed verification rejects supplied approverId.
   */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  approverId?: string;
}

export class PointHistoryQueryDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

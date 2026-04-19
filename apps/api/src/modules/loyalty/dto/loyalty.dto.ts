import {
  IsString,
  IsNumber,
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

  /**
   * T3-C3: Anti-fraud linkage to a concrete POS transaction. Without this,
   * staff could redeem points freely against "ghost" customer lookups. A
   * redemption must always reference a sale/contract/manual-POS event so
   * there's a paper trail back to who bought what.
   */
  @IsString({ message: 'กรุณาระบุเลขที่ธุรกรรม POS' })
  @MaxLength(255)
  posTransactionId: string;

  /**
   * T3-C3: OWNER override required when redeeming > 10,000 points in one
   * call. Service layer verifies the approver actually has OWNER role.
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

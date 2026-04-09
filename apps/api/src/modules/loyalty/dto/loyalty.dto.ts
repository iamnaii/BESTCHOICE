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
}

export class PointHistoryQueryDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

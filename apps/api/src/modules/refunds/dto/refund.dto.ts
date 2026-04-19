import { IsNumber, IsString, Min, MinLength, MaxLength } from 'class-validator';

export class RequestRefundDto {
  @IsString()
  paymentId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'จำนวนเงินต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  amount!: number;

  @IsString({ message: 'ต้องระบุเหตุผล' })
  @MinLength(10, { message: 'เหตุผลต้องมีอย่างน้อย 10 ตัวอักษร' })
  @MaxLength(2000)
  reason!: string;
}

export class MarkRefundReversedDto {
  @IsString({ message: 'ต้องระบุเลขอ้างอิงจากธนาคาร' })
  @MinLength(3)
  @MaxLength(200)
  bankReversalRef!: string;

  @IsString()
  @MaxLength(2000)
  notes!: string;
}

export class RejectRefundDto {
  @IsString({ message: 'ต้องระบุเหตุผลการปฏิเสธ' })
  @MinLength(5)
  @MaxLength(2000)
  reason!: string;
}

export class MarkRefundFailedDto {
  @IsString({ message: 'ต้องระบุเหตุผลที่ธนาคาร reverse ไม่สำเร็จ' })
  @MinLength(5)
  @MaxLength(2000)
  failureReason!: string;
}

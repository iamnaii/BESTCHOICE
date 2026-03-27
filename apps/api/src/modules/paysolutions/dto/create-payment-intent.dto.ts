import { IsNotEmpty, IsString, IsNumber, IsOptional, Min } from 'class-validator';

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
}

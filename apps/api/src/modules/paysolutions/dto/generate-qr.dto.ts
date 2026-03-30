import { IsOptional, IsNumber, Min } from 'class-validator';

export class GenerateQrDto {
  @IsOptional()
  @IsNumber({}, { message: 'จำนวนเงินต้องเป็นตัวเลข' })
  @Min(1, { message: 'จำนวนเงินต้องมากกว่า 0' })
  amount?: number;

  @IsOptional()
  @IsNumber()
  installmentNo?: number;
}

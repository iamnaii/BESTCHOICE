import { IsInt, Min } from 'class-validator';

export class PayInstallmentDto {
  @IsInt({ message: 'จำนวนเงินต้องเป็นจำนวนเต็ม' })
  @Min(100, { message: 'จำนวนเงินขั้นต่ำ 100 บาท' })
  amount!: number;
}

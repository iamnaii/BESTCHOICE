import { IsString, IsOptional, IsNumber, IsPositive, MaxLength, IsDateString } from 'class-validator';

export class SettleIntercompanyDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'จำนวนเงินไม่ถูกต้อง' })
  @IsPositive({ message: 'จำนวนเงินต้องมากกว่า 0' })
  amount!: number;

  @IsString({ message: 'กรุณาระบุเลขที่อ้างอิง' })
  @MaxLength(50)
  reference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsDateString()
  paidDate?: string;
}

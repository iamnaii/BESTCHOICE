import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class QuickQuoteDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุยี่ห้อ' })
  brand!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรุ่น' })
  model!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุความจุ' })
  storage!: string;

  @IsIn(['A', 'B', 'C'], { message: 'สภาพเครื่องต้องเป็น A, B หรือ C' })
  condition!: 'A' | 'B' | 'C';
}

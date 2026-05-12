import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectOtherIncomeDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหมายเหตุการปฏิเสธ' })
  @MaxLength(500)
  note!: string;
}

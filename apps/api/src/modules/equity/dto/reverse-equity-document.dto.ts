import { IsString, MinLength, MaxLength } from 'class-validator';

export class ReverseEquityDocumentDto {
  @IsString({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(10, { message: 'เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร' })
  @MaxLength(500, { message: 'เหตุผลยาวเกินไป (สูงสุด 500 ตัวอักษร)' })
  reason!: string;
}

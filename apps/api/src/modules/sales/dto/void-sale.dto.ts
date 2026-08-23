import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoidSaleDto {
  @IsString({ message: 'กรุณาระบุเหตุผลการยกเลิก' })
  @MinLength(10, { message: 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร' })
  @MaxLength(500, { message: 'เหตุผลยาวเกิน 500 ตัวอักษร' })
  reason!: string;
}

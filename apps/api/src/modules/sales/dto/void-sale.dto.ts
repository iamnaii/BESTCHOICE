import { IsString, MinLength } from 'class-validator';

export class VoidSaleDto {
  @IsString({ message: 'กรุณาระบุเหตุผลการยกเลิก' })
  @MinLength(10, { message: 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร' })
  reason!: string;
}

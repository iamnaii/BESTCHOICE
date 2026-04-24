import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RejectMdmDto {
  @IsString({ message: 'กรุณาระบุเหตุผล' })
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผล' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason!: string;
}

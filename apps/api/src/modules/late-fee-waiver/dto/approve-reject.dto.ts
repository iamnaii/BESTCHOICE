import { IsString, MinLength } from 'class-validator';

export class RejectLateFeeWaiverDto {
  @IsString()
  @MinLength(5, { message: 'กรุณาระบุเหตุผลการปฏิเสธอย่างน้อย 5 ตัวอักษร' })
  reason!: string;
}

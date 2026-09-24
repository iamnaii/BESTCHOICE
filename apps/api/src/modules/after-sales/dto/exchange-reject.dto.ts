import { IsString, MinLength } from 'class-validator';

export class ExchangeRejectDto {
  @IsString()
  @MinLength(10, { message: 'ต้องระบุเหตุผลการปฏิเสธ (อย่างน้อย 10 ตัวอักษร)' })
  reason!: string;
}

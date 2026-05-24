import { IsString, MinLength } from 'class-validator';

export class RejectExchangeRequestDto {
  @IsString()
  @MinLength(10, { message: 'เหตุผลอย่างน้อย 10 ตัวอักษร' })
  reason!: string;
}

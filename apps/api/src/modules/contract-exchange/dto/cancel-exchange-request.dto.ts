import { IsString, MinLength } from 'class-validator';

export class CancelExchangeRequestDto {
  @IsString()
  @MinLength(10, { message: 'เหตุผลยกเลิกอย่างน้อย 10 ตัวอักษร' })
  reason!: string;
}

import { IsString, MinLength } from 'class-validator';

export class CancelCaseDto {
  @IsString()
  @MinLength(10, { message: 'ต้องระบุเหตุผลการยกเลิก (อย่างน้อย 10 ตัวอักษร)' })
  reason!: string;
}

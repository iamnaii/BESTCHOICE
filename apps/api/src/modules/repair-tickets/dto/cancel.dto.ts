import { IsString, MinLength } from 'class-validator';

export class CancelDto {
  @IsString()
  @MinLength(5, { message: 'ต้องระบุเหตุผลการยกเลิก (อย่างน้อย 5 ตัวอักษร)' })
  note!: string;
}

import { Matches, IsString, MinLength } from 'class-validator';

export class ReverseDepreciationRunDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'รูปแบบงวดต้องเป็น YYYY-MM' })
  period!: string;

  @IsString()
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason!: string;
}

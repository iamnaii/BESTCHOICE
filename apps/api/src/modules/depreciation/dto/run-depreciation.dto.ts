import { Matches } from 'class-validator';

export class RunDepreciationDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'รูปแบบงวดต้องเป็น YYYY-MM' })
  period!: string;
}

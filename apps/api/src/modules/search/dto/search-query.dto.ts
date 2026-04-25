import { IsString, MinLength, MaxLength } from 'class-validator';

export class SearchQueryDto {
  @IsString({ message: 'กรุณาระบุคำค้น' })
  @MinLength(2, { message: 'คำค้นต้องมีอย่างน้อย 2 ตัวอักษร' })
  @MaxLength(100, { message: 'คำค้นยาวเกินไป' })
  q!: string;
}

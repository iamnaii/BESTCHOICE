import { IsString, MinLength } from 'class-validator';

export class LookupByImeiDto {
  @IsString({ message: 'imei ต้องเป็น string' })
  @MinLength(4, { message: 'imei ต้องมีอย่างน้อย 4 ตัวอักษร' })
  imei!: string;
}

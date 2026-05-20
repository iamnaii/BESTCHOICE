import { IsOptional, IsUUID, IsString, MinLength } from 'class-validator';

export class WarrantyLookupDto {
  @IsOptional()
  @IsUUID('all', { message: 'customerId ต้องเป็น UUID' })
  customerId?: string;

  @IsOptional()
  @IsString({ message: 'imei ต้องเป็น string' })
  @MinLength(4, { message: 'imei ต้องมีอย่างน้อย 4 ตัวอักษร' })
  imei?: string;

  @IsOptional()
  @IsString({ message: 'serial ต้องเป็น string' })
  @MinLength(4, { message: 'serial ต้องมีอย่างน้อย 4 ตัวอักษร' })
  serial?: string;

  @IsOptional()
  @IsString({ message: 'contractNumber ต้องเป็น string' })
  @MinLength(3, { message: 'contractNumber ต้องมีอย่างน้อย 3 ตัวอักษร' })
  contractNumber?: string;
}

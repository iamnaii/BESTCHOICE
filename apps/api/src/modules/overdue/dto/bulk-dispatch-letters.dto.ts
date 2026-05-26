import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class BulkDispatchItemDto {
  @IsUUID('4', { message: 'รหัสจดหมายไม่ถูกต้อง' })
  id!: string;

  @IsString({ message: 'กรุณาระบุเลข tracking' })
  @MinLength(5, { message: 'เลข tracking ต้องมีอย่างน้อย 5 ตัวอักษร' })
  trackingNumber!: string;

  @IsOptional()
  @IsUrl({}, { message: 'URL หลักฐานไม่ถูกต้อง' })
  evidencePhotoUrl?: string;
}

export class BulkDispatchLettersDto {
  @ValidateNested({ each: true })
  @Type(() => BulkDispatchItemDto)
  @ArrayMinSize(1, { message: 'ต้องเลือกอย่างน้อย 1 ฉบับ' })
  @ArrayMaxSize(50, { message: 'ส่งครั้งละไม่เกิน 50 ฉบับ' })
  items!: BulkDispatchItemDto[];
}

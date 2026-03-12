import { IsString, IsArray, ValidateNested, MaxLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class SettingItemDto {
  @IsString()
  @MaxLength(100, { message: 'key ต้องไม่เกิน 100 ตัวอักษร' })
  @Matches(/^[a-z_]+$/, { message: 'key ต้องเป็น snake_case เท่านั้น' })
  key: string;

  @IsString()
  @MaxLength(500000, { message: 'value ต้องไม่เกิน 500000 ตัวอักษร' })
  value: string;
}

export class BulkUpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingItemDto)
  items: SettingItemDto[];
}

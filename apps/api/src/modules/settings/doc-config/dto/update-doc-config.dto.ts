import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateDocConfigDto {
  @IsOptional()
  @IsString({ message: 'รูปแบบ prefix ต้องเป็นตัวอักษร' })
  @MaxLength(20, { message: 'prefix ยาวเกิน 20 ตัวอักษร' })
  prefix?: string;

  @IsOptional()
  @IsString({ message: 'รูปแบบ format ต้องเป็นตัวอักษร' })
  @MaxLength(100, { message: 'format ยาวเกิน 100 ตัวอักษร' })
  format?: string;

  @IsOptional()
  @IsIn(['DAILY', 'MONTHLY', 'YEARLY', 'NEVER'], {
    message: 'resetCadence ต้องเป็น DAILY/MONTHLY/YEARLY/NEVER',
  })
  resetCadence?: 'DAILY' | 'MONTHLY' | 'YEARLY' | 'NEVER';

  @IsOptional()
  @IsInt({ message: 'digitCount ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'digitCount ต้องไม่น้อยกว่า 1' })
  @Max(10, { message: 'digitCount ต้องไม่เกิน 10' })
  digitCount?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'notes ยาวเกิน 200 ตัวอักษร' })
  notes?: string;
}

export class PreviewDocConfigDto {
  @IsOptional()
  @IsString()
  sampleDate?: string; // ISO string; defaults to now

  @IsOptional()
  @IsString()
  @MaxLength(20)
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  format?: string;

  @IsOptional()
  @IsIn(['DAILY', 'MONTHLY', 'YEARLY', 'NEVER'])
  resetCadence?: 'DAILY' | 'MONTHLY' | 'YEARLY' | 'NEVER';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  digitCount?: number;
}

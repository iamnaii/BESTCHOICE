import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateDocConfigDto {
  // W1 (DEEP review): reject `{` / `}` so prefix cannot smuggle in tokens
  // like `{YYYY}` that would expand during format substitution.
  @IsOptional()
  @IsString({ message: 'รูปแบบ prefix ต้องเป็นตัวอักษร' })
  @MaxLength(20, { message: 'prefix ยาวเกิน 20 ตัวอักษร' })
  @Matches(/^[^{}]*$/, { message: 'ห้ามใช้เครื่องหมาย { } ใน prefix' })
  prefix?: string;

  // W3 (DEEP review): every format must contain at least one sequence token
  // ({SEQ} or {NNNN}). Without one the running number has nowhere to go and
  // every doc collides on the same name.
  @IsOptional()
  @IsString({ message: 'รูปแบบ format ต้องเป็นตัวอักษร' })
  @MaxLength(100, { message: 'format ยาวเกิน 100 ตัวอักษร' })
  @Matches(/\{(SEQ|N+)\}/, {
    message: 'รูปแบบต้องมี {SEQ} หรือ {NNNN} อย่างน้อย 1 อัน',
  })
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
  @Matches(/^[^{}]*$/, { message: 'ห้ามใช้เครื่องหมาย { } ใน prefix' })
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/\{(SEQ|N+)\}/, {
    message: 'รูปแบบต้องมี {SEQ} หรือ {NNNN} อย่างน้อย 1 อัน',
  })
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

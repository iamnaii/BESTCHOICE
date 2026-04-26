import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SkipReason } from '@prisma/client';

export class SkipDto {
  @IsEnum(SkipReason, { message: 'เหตุผลข้ามไม่ถูกต้อง' })
  reason: SkipReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

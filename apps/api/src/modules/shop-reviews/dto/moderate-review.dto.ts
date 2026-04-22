import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerateReviewDto {
  @IsIn(['HIDDEN', 'PUBLISHED'], { message: 'สถานะต้องเป็น HIDDEN หรือ PUBLISHED' })
  status!: 'HIDDEN' | 'PUBLISHED';

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' })
  reason?: string;
}

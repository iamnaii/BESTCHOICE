import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateVariantDto {
  /**
   * Optional override for the variant name. Defaults to `${parent.name} (variant)`
   * with a numeric suffix when collisions occur.
   */
  @IsOptional()
  @IsString({ message: 'name ต้องเป็น string' })
  @MinLength(1, { message: 'name ต้องไม่ว่าง' })
  @MaxLength(100, { message: 'name ยาวเกิน 100 ตัวอักษร' })
  name?: string;

  /**
   * Optional body override. When omitted, the variant body is copied from
   * the parent so the operator can A/B-test minor wording changes.
   */
  @IsOptional()
  @IsString({ message: 'body ต้องเป็น string' })
  @MaxLength(2000, { message: 'body ยาวเกิน 2000 ตัวอักษร' })
  body?: string;
}

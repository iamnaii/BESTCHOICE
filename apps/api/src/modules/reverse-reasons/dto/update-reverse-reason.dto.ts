import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateReverseReasonDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'ข้อความสั้นเกินไป' })
  @MaxLength(200, { message: 'ข้อความยาวเกินไป (สูงสุด 200 ตัวอักษร)' })
  label?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

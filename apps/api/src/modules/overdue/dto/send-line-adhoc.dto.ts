import { IsOptional, IsString, MinLength } from 'class-validator';

export class SendLineAdHocDto {
  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'ข้อความต้อง ≥ 10 ตัวอักษร' })
  customMessage?: string;
}

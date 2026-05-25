import { IsString, IsOptional, IsEnum, MaxLength, IsNotEmpty } from 'class-validator';

export class CreateQuickReplyDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ label' })
  @MaxLength(20, { message: 'label ยาวเกิน 20 ตัวอักษร' })
  label!: string;

  @IsEnum(['POSTBACK', 'URL', 'MESSAGE'], {
    message: 'type ต้องเป็น POSTBACK / URL / MESSAGE',
  })
  type!: 'POSTBACK' | 'URL' | 'MESSAGE';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  payload?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}

import { IsOptional, IsString, IsEnum, MaxLength, IsInt, Min } from 'class-validator';

export class UpdateQuickReplyDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  label?: string;

  @IsOptional()
  @IsEnum(['POSTBACK', 'URL', 'MESSAGE'])
  type?: 'POSTBACK' | 'URL' | 'MESSAGE';

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

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

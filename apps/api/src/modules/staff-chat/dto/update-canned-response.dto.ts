import { IsOptional, IsString, IsBoolean, IsInt, Min, MaxLength } from 'class-validator';

export class UpdateCannedResponseDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  hideFromChat?: boolean;

  @IsOptional()
  @IsBoolean()
  verifiedOnly?: boolean;
}

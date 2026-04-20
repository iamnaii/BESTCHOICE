import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class TrackVisitDto {
  @IsString()
  sessionId!: string;

  @IsString()
  pagePath!: string;

  @IsOptional()
  @IsString()
  referrer?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;
}

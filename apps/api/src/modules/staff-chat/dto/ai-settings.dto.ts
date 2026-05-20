import { IsBoolean, IsNumber, IsArray, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpdateAiSettingsDto {
  @IsBoolean()
  @IsOptional()
  aiAutoEnabled?: boolean;

  @IsArray()
  @IsOptional()
  aiAutoChannels?: string[];

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aiAutoConfidenceThreshold?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(20)
  aiAutoMaxRepliesPerSession?: number;

  @IsOptional()
  @IsString()
  shopBotCentralBranchId?: string;

  @IsOptional()
  @IsString()
  shopBotPromptpayId?: string;

  @IsOptional()
  @IsString()
  shopBotTestUserId?: string;
}

export interface AiAutoSettings {
  aiAutoEnabled: boolean;
  aiAutoChannels: string[];
  aiAutoConfidenceThreshold: number;
  aiAutoMaxRepliesPerSession: number;
  shopBotCentralBranchId: string | null;
  shopBotPromptpayId: string | null;
  shopBotTestUserId: string | null;
}

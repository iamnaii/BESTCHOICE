import { IsBoolean, IsNumber, IsArray, IsIn, IsOptional, IsString, Min, Max } from 'class-validator';

export const LLM_PROVIDERS = ['claude', 'gemini'] as const;
export type LlmProviderChoice = (typeof LLM_PROVIDERS)[number];

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
  @Max(100)
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

  @IsOptional()
  @IsIn(LLM_PROVIDERS, { message: 'llmProvider ต้องเป็น "claude" หรือ "gemini" เท่านั้น' })
  llmProvider?: LlmProviderChoice;
}

export interface AiAutoSettings {
  aiAutoEnabled: boolean;
  aiAutoChannels: string[];
  aiAutoConfidenceThreshold: number;
  aiAutoMaxRepliesPerSession: number;
  shopBotCentralBranchId: string | null;
  shopBotPromptpayId: string | null;
  shopBotTestUserId: string | null;
  llmProvider: LlmProviderChoice;
}

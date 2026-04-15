import { IsOptional, IsString } from 'class-validator';

export class AiSuggestRequestDto {
  @IsOptional()
  @IsString()
  currentDraft?: string;
}

export interface AiSuggestion {
  text: string;
  intent: string;
  confidence: number;
}

export interface AiSuggestResponse {
  suggestions: AiSuggestion[];
  detectedProducts: string[];
  processingTimeMs: number;
}

import {
  IsBoolean,
  IsNumber,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

export const LLM_PROVIDERS = ['claude', 'gemini'] as const;
export type LlmProviderChoice = (typeof LLM_PROVIDERS)[number];

/**
 * Persona size caps. These are SystemConfig.value (TEXT column, unbounded by
 * Postgres) so the only reason to cap is to prevent runaway payloads /
 * pathological prompts. Current hardcoded BASE ≈ 4 KB, EXTRAS ≈ 4 KB; caps
 * leave headroom for the owner to ~5× expand each section.
 */
export const PERSONA_BASE_MAX = 20_000;
export const PERSONA_BOT_EXTRAS_MAX = 30_000;

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

  /**
   * SHOP sales persona — BASE layer (identity + tone). Used by both
   * AiSuggest and SalesBot.
   *
   * Sentinel semantics:
   * - `undefined` / `null` (key absent or explicit null) → skip; keep saved
   *   value (per PR #1059 null-skip pattern).
   * - `''` (empty string) → revert to hardcoded default (service soft-deletes
   *   the SystemConfig row so PersonaService falls back).
   * - non-empty string → upsert as override.
   *
   * `PersonaService.invalidateCache()` is called after either persona field
   * is processed so the change is live on the next message.
   */
  @IsOptional()
  @IsString()
  @MaxLength(PERSONA_BASE_MAX, {
    message: `persona BASE ต้องไม่เกิน ${PERSONA_BASE_MAX} ตัวอักษร`,
  })
  shopBotPersonaBase?: string;

  /**
   * SHOP sales persona — BOT_EXTRAS layer (tool-use playbook). Appended after
   * BASE for SalesBot only. Same sentinel semantics as `shopBotPersonaBase`.
   *
   * The frontend lint warns the owner if a saved override drops references to
   * any of the registered tool names (`search_products`, `calculate_installment`,
   * `list_promotions`, `capture_lead`, `handoff_to_human`). Backend doesn't
   * enforce — that's UI guidance, not a hard contract — but the owner sees the
   * warning before saving.
   */
  @IsOptional()
  @IsString()
  @MaxLength(PERSONA_BOT_EXTRAS_MAX, {
    message: `persona BOT_EXTRAS ต้องไม่เกิน ${PERSONA_BOT_EXTRAS_MAX} ตัวอักษร`,
  })
  shopBotPersonaBotExtras?: string;
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

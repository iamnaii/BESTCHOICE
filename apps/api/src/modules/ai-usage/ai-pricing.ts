/**
 * Per-model Claude pricing in USD per 1M tokens (Jan 2026 rate card).
 *
 * Kept as a static table because:
 *  - The Anthropic API does not return cost in-band, only token counts
 *  - We don't want to change price calculation by reaching out to the API
 *  - When Anthropic changes prices, we edit this file and PR it so the
 *    history shows exactly when the team updated the rates
 *
 * Unknown model ids fall through to a conservative default (haiku rate) so
 * we always log _something_; usage tracking must never silently skip a call.
 */

export interface ModelRate {
  inputPer1M: number;
  outputPer1M: number;
}

// Prices in USD per 1 million tokens.
// https://www.anthropic.com/pricing (snapshot 2026-01)
const RATE_CARD: Record<string, ModelRate> = {
  // Claude 4.x — Jan 2026
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet-4-5-20250514': { inputPer1M: 3, outputPer1M: 15 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5-20251001': { inputPer1M: 0.8, outputPer1M: 4 },
  // Fallback
  default: { inputPer1M: 3, outputPer1M: 15 },
};

export function ratesFor(model: string): ModelRate {
  return RATE_CARD[model] ?? RATE_CARD.default;
}

/** Returns USD cost rounded to 6 decimal places. */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = ratesFor(model);
  const cost =
    (inputTokens / 1_000_000) * rate.inputPer1M +
    (outputTokens / 1_000_000) * rate.outputPer1M;
  // 6 decimals — matches Decimal(12,6) in schema
  return Math.round(cost * 1_000_000) / 1_000_000;
}

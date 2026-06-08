/**
 * Pure normalisation primitives for SystemConfig-backed UI flags, extracted
 * from the 840-line `SettingsService.getUiFlags` (Wave-4 decomposition).
 *
 * Each takes a raw value (already read from SystemConfig) and returns the
 * typed, validated flag with its documented fallback. No I/O — fully testable
 * in isolation, and the call sites collapse from 4-6 line ternary ladders to
 * a single expression.
 */

/**
 * Whitelist a raw string against `allowed`; return it when present, else
 * `fallback`. Replaces the `raw === 'a' ? 'a' : raw === 'b' ? 'b' : fallback`
 * ladders. The generic keeps the literal-union return type so call sites stay
 * type-checked against the field's declared union.
 */
export function pickEnum<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(raw as string) ? (raw as T) : fallback;
}

/**
 * Accept `raw` only when it is an integer within [min, max] inclusive;
 * otherwise `fallback`. Replaces
 * `Number.isInteger(x) && x >= min && x <= max ? x : fb`.
 */
export function clampInt(raw: number, min: number, max: number, fallback: number): number {
  return Number.isInteger(raw) && raw >= min && raw <= max ? raw : fallback;
}

/**
 * Accept `raw` when it is finite within [min, max] inclusive (floored to an
 * integer); otherwise `fallback`. Replaces
 * `Number.isFinite(x) && x >= min && x <= max ? Math.floor(x) : fb`.
 */
export function clampFloat(raw: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(raw) && raw >= min && raw <= max ? Math.floor(raw) : fallback;
}

/**
 * Parse a JSON array-of-strings config value. Returns the string-only
 * elements. Non-array / parse-error → `fallback`; when `requireNonEmpty` is
 * set, an empty-after-filter result also falls back (used where a default
 * must never be silently emptied, e.g. `['PAYROLL']`).
 */
export function parseStringArray(
  raw: string | null | undefined,
  fallback: string[],
  opts: { requireNonEmpty?: boolean } = {},
): string[] {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const filtered = parsed.filter((v): v is string => typeof v === 'string');
    if (opts.requireNonEmpty && filtered.length === 0) return fallback;
    return filtered;
  } catch {
    return fallback;
  }
}

/**
 * Number formatting for the storefront — always Thai grouping (42,900).
 *
 * toLocaleString with no locale formats with the shopper's phone language, so a
 * phone set to Vietnamese/Indonesian/German shows 42.900 (reads like 42.9 baht),
 * French shows "42 900" and Arabic shows Arabic digits (owner 2026-11-26).
 * Every price/number on the storefront goes through here; format.test.ts fails
 * the build if a locale-less call comes back.
 *
 * Defaults match the bare call it replaces (0–3 fraction digits), so Thai
 * phones see exactly what they saw before.
 */
const LOCALE = 'th-TH';
const defaultFormatter = new Intl.NumberFormat(LOCALE);

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return options ? value.toLocaleString(LOCALE, options) : defaultFormatter.format(value);
}

/**
 * D1.1.3.2 + D1.1.3.5 — helpers for the configurable WHT rates dropdown.
 *
 * The raw `whtRates` array comes from `useUiFlags()` (server SystemConfig).
 * Each entry may carry an optional `effectiveDate` (ISO-8601 string). Entries
 * whose date is strictly after `now` are HIDDEN from the dropdown — they
 * exist in storage (history / future planning) but should not be selectable
 * yet. Entries with no `effectiveDate` are always active.
 *
 * Pulled out of `ItemLinesSection.tsx` into a pure helper so the filter
 * logic is unit-testable without rendering React.
 */

export interface WhtRateEntry {
  rate: number;
  label: string;
  effectiveDate?: string | null;
}

export interface WhtOption {
  value: string;
  label: string;
}

/**
 * Filter `whtRates` down to entries that are "active as of `now`",
 * preserving order. Default `now` = current real time.
 *
 * An entry is active when:
 *   - `effectiveDate` is missing / null / empty string, OR
 *   - `new Date(effectiveDate) <= now`
 *
 * Unparseable dates fall back to "include" (server validation already
 * rejects malformed entries — the UI never sees them — but be permissive
 * if any slip through, since omitting a usable rate is worse than
 * showing an extra one).
 */
export function filterActiveWhtRates(
  whtRates: ReadonlyArray<WhtRateEntry>,
  now: Date = new Date(),
): WhtRateEntry[] {
  const nowMs = now.getTime();
  return whtRates.filter((r) => {
    if (!r.effectiveDate) return true;
    const t = Date.parse(r.effectiveDate);
    if (Number.isNaN(t)) return true;
    return t <= nowMs;
  });
}

/**
 * Convert the active rates into `<select>` options, prepended with the
 * always-available "0%" no-WHT option.
 */
export function whtRatesToSelectOptions(
  whtRates: ReadonlyArray<WhtRateEntry>,
  now: Date = new Date(),
): WhtOption[] {
  return [
    { value: '0', label: '0%' },
    ...filterActiveWhtRates(whtRates, now).map((r) => ({
      value: String(r.rate),
      label: r.label,
    })),
  ];
}

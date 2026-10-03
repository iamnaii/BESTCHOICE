/**
 * D1.1.2.2 — whitelisted document-number layout strings.
 *
 * The Settings_Audit_Core_v2.0 spec (row 1.2.2) calls for `YYMMNNN`. We
 * concretise that as `PREFIX-YYMM-NNN` (4-digit period + 3-digit seq) and
 * make it the project default. Three legacy / extended variants stay in the
 * whitelist so OWNERs can opt-in to higher daily / yearly volume:
 *
 *   - `PREFIX-YYMM-NNN`     (spec default — short, monthly window, 3 digits)
 *   - `PREFIX-YYYYMMDD-NNNN` (legacy v1, daily window, 4 digits)
 *   - `PREFIX-YYYYMM-NNNNN`  (monthly window, 5 digits — high-volume)
 *   - `PREFIX-YYYY-NNNNNN`   (yearly window, 6 digits — very-high-volume)
 *
 * Unknown values silently fall back to the spec default at read time so doc
 * creation never blocks on a bad SystemConfig row.
 */
export type DocumentNumberFormat =
  | 'PREFIX-YYMM-NNN'
  | 'PREFIX-YYYYMMDD-NNNN'
  | 'PREFIX-YYYYMM-NNNNN'
  | 'PREFIX-YYYY-NNNNNN';

/**
 * D1.1.2.2 — map a `DocNumberFormat` to its date portion + seq width.
 * Pure function; no DB / IO.
 */
export function documentNumberLayout(
  issueDate: Date,
  format: DocumentNumberFormat,
): { datePortion: string; seqWidth: number } {
  switch (format) {
    case 'PREFIX-YYYYMM-NNNNN':
      return { datePortion: bkkYyyymm(issueDate), seqWidth: 5 };
    case 'PREFIX-YYYY-NNNNNN':
      return { datePortion: bkkYyyy(issueDate), seqWidth: 6 };
    case 'PREFIX-YYYYMMDD-NNNN':
      return { datePortion: bkkYyyymmdd(issueDate), seqWidth: 4 };
    case 'PREFIX-YYMM-NNN':
    default:
      return { datePortion: bkkYymm(issueDate), seqWidth: 3 };
  }
}

/** Asia/Bangkok local YYYYMMDD via Intl (BKK is UTC+7, no DST). */
/** Asia/Bangkok local YYYYMM via Intl. */
/** Asia/Bangkok local YYYY via Intl. */
export function bkkYyyymmdd(date: Date): string {
  const parts = date.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

export function bkkYyyymm(date: Date): string {
  const parts = date.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  });
  // Defensive: en-CA with year+month returns "YYYY-MM" today, but slice the
  // first two segments to stay robust against ICU output shape drift across
  // Node versions.
  return parts.split('-').slice(0, 2).join('');
}

export function bkkYyyy(date: Date): string {
  return date.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  });
}

/**
 * D1.1.2.2 — Asia/Bangkok local YYMM (2-digit year + 2-digit month).
 * Used by the spec-default `PREFIX-YYMM-NNN` format.
 *
 * Spec uses Gregorian (ค.ศ.) 2-digit year for grep-ability with PEAK and
 * other Thai accounting tools that historically use YY-prefix doc numbers.
 * For 2026 → `YY = 26`; for 2100 → `YY = 00` (wraps). This is acceptable
 * because doc-numbers reset annually under the spec default cycle (yearly)
 * so cross-century collisions are extremely unlikely AND would be on
 * different years anyway (different reset window).
 */
export function bkkYymm(date: Date): string {
  const yyyymm = bkkYyyymm(date); // "YYYYMM"
  return yyyymm.slice(2); // "YYMM"
}

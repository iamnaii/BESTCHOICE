/**
 * SP4 — Document number format utilities.
 *
 * Pure helpers used by DocNumberService implementations to:
 *   - Compute Asia/Bangkok period bounds (DAILY/MONTHLY/YEARLY/NEVER)
 *   - Substitute format tokens like {prefix}, {YYYY}, {NNNN} into a template
 *   - Parse the trailing sequence digits out of an existing doc number
 *
 * Single source of truth so the new SP4 config-driven path and the legacy
 * per-module DocNumberService classes agree on behavior.
 */

export type ResetCadence = 'DAILY' | 'MONTHLY' | 'YEARLY' | 'NEVER';

export interface DocNumberConfigLike {
  prefix: string;
  format: string;
  resetCadence: ResetCadence | string;
  digitCount: number;
}

export interface BkkDateParts {
  yyyy: string;
  mm: string;
  dd: string;
  yyyymm: string;
  yyyymmdd: string;
}

/** Asia/Bangkok local date parts. BKK is UTC+7 with no DST. */
export function getBkkDateParts(date: Date): BkkDateParts {
  const parts = date.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA format: "YYYY-MM-DD"
  const [y, m, d] = parts.split('-');
  return {
    yyyy: y,
    mm: m,
    dd: d,
    yyyymm: `${y}${m}`,
    yyyymmdd: `${y}${m}${d}`,
  };
}

export interface PeriodBounds {
  start: Date;
  end: Date;
  /** Cache-friendly key for advisory locks: per-cadence period identifier. */
  periodKey: string;
}

/** Period bounds for a given Asia/Bangkok date + reset cadence. */
export function getPeriodBounds(date: Date, cadence: string): PeriodBounds {
  const { yyyy, mm, dd, yyyymm, yyyymmdd } = getBkkDateParts(date);
  const y = parseInt(yyyy, 10);
  const m = parseInt(mm, 10);
  const d = parseInt(dd, 10);
  const bkkOffsetMs = 7 * 60 * 60 * 1000;

  switch (cadence) {
    case 'MONTHLY': {
      const start = new Date(Date.UTC(y, m - 1, 1) - bkkOffsetMs);
      const end = new Date(Date.UTC(y, m, 1) - bkkOffsetMs);
      return { start, end, periodKey: yyyymm };
    }
    case 'YEARLY': {
      const start = new Date(Date.UTC(y, 0, 1) - bkkOffsetMs);
      const end = new Date(Date.UTC(y + 1, 0, 1) - bkkOffsetMs);
      return { start, end, periodKey: yyyy };
    }
    case 'NEVER': {
      // No period filter — use a single fixed bucket.
      return {
        start: new Date(0),
        end: new Date('9999-12-31T00:00:00Z'),
        periodKey: 'all',
      };
    }
    case 'DAILY':
    default: {
      const start = new Date(Date.UTC(y, m - 1, d) - bkkOffsetMs);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      return { start, end, periodKey: yyyymmdd };
    }
  }
}

/**
 * Substitute format tokens into the template.
 * Recognized tokens:
 *   {prefix}        — config.prefix
 *   {YYYY} {MM} {DD}
 *   {YYYYMMDD} {YYYYMM}
 *   {NNNN} {NNN} {NN} {N} — sequence padded to that many digits
 *   {SEQ}           — sequence padded to config.digitCount
 */
export function formatDocNumber(
  template: string,
  prefix: string,
  seq: number,
  date: Date,
  digitCount: number,
): string {
  const parts = getBkkDateParts(date);
  const seqStr = String(seq);
  const padded = (n: number) => seqStr.padStart(Math.max(1, n), '0');

  return template
    .replace(/\{prefix\}/g, prefix)
    .replace(/\{YYYYMMDD\}/g, parts.yyyymmdd)
    .replace(/\{YYYYMM\}/g, parts.yyyymm)
    .replace(/\{YYYY\}/g, parts.yyyy)
    .replace(/\{MM\}/g, parts.mm)
    .replace(/\{DD\}/g, parts.dd)
    .replace(/\{SEQ\}/g, padded(digitCount))
    .replace(/\{N+\}/g, (m) => padded(m.length - 2));
}

/**
 * Build a `LIKE` prefix used to look up the last issued number in a period.
 * Anything before the sequence token is captured verbatim; the sequence token
 * itself is replaced with `%` so a LIKE/`startsWith` query matches all numbers
 * for that period.
 */
export function buildStartsWithPrefix(
  template: string,
  prefix: string,
  date: Date,
): string {
  const parts = getBkkDateParts(date);
  // Replace literal date/prefix tokens, then drop everything from the first
  // sequence token onward — that's the slot the running seq fills.
  const filled = template
    .replace(/\{prefix\}/g, prefix)
    .replace(/\{YYYYMMDD\}/g, parts.yyyymmdd)
    .replace(/\{YYYYMM\}/g, parts.yyyymm)
    .replace(/\{YYYY\}/g, parts.yyyy)
    .replace(/\{MM\}/g, parts.mm)
    .replace(/\{DD\}/g, parts.dd);
  const seqTokenIndex = filled.search(/\{SEQ\}|\{N+\}/);
  return seqTokenIndex === -1 ? filled : filled.slice(0, seqTokenIndex);
}

/**
 * Parse the trailing sequence digits out of a doc number that was formatted
 * with the same template. Returns 0 if the number doesn't parse cleanly.
 */
export function parseSequence(docNumber: string, startsWith: string): number {
  if (!docNumber.startsWith(startsWith)) return 0;
  const tail = docNumber.slice(startsWith.length);
  // Take leading digits only; anything else is a suffix like '-R'.
  const match = tail.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Deterministic 32-bit hash for advisory lock keys. */
export function hashLockKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return h;
}

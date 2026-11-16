/**
 * Thai-aware search for pick lists (spec §6.2).
 *
 * normalizeThai folds the spellings a Thai keyboard produces for the same text,
 * rankMatch scores one item against a query, filterAndRank keeps the matches in
 * rank order. Pure functions — no React, no DOM.
 *
 * Do not swap in a shared helper that uses NFKC: NFKC splits sara am (U+0E33)
 * back into nikhahit + sara aa, the opposite of the fold below.
 */

// U+200B ZERO WIDTH SPACE, U+200C ZWNJ, U+200D ZWJ, U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM).
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
// NIKHAHIT U+0E4D + optional tone mark U+0E48–U+0E4B + SARA AA U+0E32 → tone + SARA AM U+0E33.
// Both typing orders of น้ำ ("น ํ ้ า" and "น ้ ํ า") end up as U+0E19 U+0E49 U+0E33.
const NIKHAHIT_AA = /\u0E4D([\u0E48-\u0E4B]?)\u0E32/g;
// Two SARA E (U+0E40 U+0E40) typed for one SARA AE (U+0E41).
const DOUBLE_SARA_E = /\u0E40\u0E40/g;
// Thai digits ๐–๙ (U+0E50–U+0E59).
const THAI_DIGIT = /[\u0E50-\u0E59]/g;
// Leading vowels เ แ โ ใ ไ (U+0E40–U+0E44): written before the consonant they follow in speech.
const LEADING_VOWEL = /^[\u0E40-\u0E44]/;
// Word separators for rank 2: whitespace, punctuation, symbols ("52-1104 ส่วนลด", "สาขา (ลาดพร้าว)").
const WORD_SEPARATOR = /[\s\p{P}\p{S}]+/u;

export function normalizeThai(s: string): string {
  return s
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(NIKHAHIT_AA, '$1\u0E33')
    .replace(DOUBLE_SARA_E, '\u0E41')
    .toLowerCase()
    .trim()
    .replace(THAI_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0e50));
}

/** 1 = label starts with the query · 2 = after one leading vowel, or a word starts with it · 3 = label contains it · 4 = a keyword contains it. */
export type MatchRank = 1 | 2 | 3 | 4;

export interface Searchable {
  label: string;
  keywords?: readonly string[];
}

function startsAfterLeadingVowel(text: string, query: string): boolean {
  return LEADING_VOWEL.test(text) && text.startsWith(query, 1);
}

/** `query` must already be normalized and non-empty. */
function rankNormalized(item: Searchable, query: string): MatchRank | null {
  const label = normalizeThai(item.label);
  if (label.startsWith(query)) return 1;
  if (startsAfterLeadingVowel(label, query)) return 2;
  const words = label.split(WORD_SEPARATOR);
  if (words.some((word) => word.startsWith(query) || startsAfterLeadingVowel(word, query))) {
    return 2;
  }
  if (label.includes(query)) return 3;
  if (item.keywords?.some((keyword) => normalizeThai(keyword).includes(query))) return 4;
  return null;
}

/** Best rank of `item` for `query`, or `null` when it does not match. An empty query matches everything at rank 1. */
export function rankMatch(item: Searchable, query: string): MatchRank | null {
  const q = normalizeThai(query);
  return q ? rankNormalized(item, q) : 1;
}

/** Items that match `query`, best rank first; items of the same rank keep their original order. */
export function filterAndRank<T extends Searchable>(items: readonly T[], query: string): T[] {
  const q = normalizeThai(query);
  if (!q) return [...items];
  const matches: { item: T; rank: MatchRank; index: number }[] = [];
  items.forEach((item, index) => {
    const rank = rankNormalized(item, q);
    if (rank !== null) matches.push({ item, rank, index });
  });
  matches.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return matches.map((match) => match.item);
}

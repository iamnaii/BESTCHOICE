/**
 * Replace Thai locale tokens in template text. Always evaluated in Asia/Bangkok.
 * Tokens:
 *   {เดือน}   → Thai short month abbreviation, e.g. "พ.ค."
 *   {ปี}      → Buddhist Era year, e.g. "2569"
 *   {เดือนปี} → combined, e.g. "พ.ค. 2569"
 */

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function getBkkParts(date: Date): { month: number; year: number } {
  // `en-CA` locale yields YYYY-MM-DD which is trivial to parse.
  const ymd = date.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m] = ymd.split('-').map(Number);
  return { month: m, year: y };
}

export function replaceVariables(text: string, now: Date): string {
  if (!text) return text;
  const { month, year } = getBkkParts(now);
  const monthStr = THAI_MONTHS_SHORT[month - 1];
  const beYear = year + 543;

  return text
    // Note: {เดือนปี} must be replaced before {เดือน} to avoid partial-match consuming the prefix
    .replace(/\{เดือนปี\}/g, `${monthStr} ${beYear}`)
    .replace(/\{เดือน\}/g, monthStr)
    .replace(/\{ปี\}/g, String(beYear));
}

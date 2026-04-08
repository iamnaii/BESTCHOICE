/**
 * Thai Buddhist Era (พ.ศ.) date formatting helpers.
 *
 * Rule: Database/API stores dates as Gregorian ISO 8601.
 * UI must always display in พ.ศ. (ค.ศ. + 543).
 *
 * Do NOT use `toLocaleDateString`, `date-fns format()`, or `dayjs().format()`
 * directly in components — use these helpers instead so พ.ศ. is consistent.
 */

export const THAI_MONTHS_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

type DateInput = Date | string | number | null | undefined;

function toDate(input: DateInput): Date | null {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => n.toString().padStart(2, '0');

/**
 * DD/MM/YYYY (พ.ศ.) — e.g. "08/04/2569"
 */
export function formatThaiDate(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '-';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543}`;
}

/**
 * D MMMM YYYY (พ.ศ.) — e.g. "8 เมษายน 2569"
 */
export function formatThaiDateLong(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '-';
  return `${d.getDate()} ${THAI_MONTHS_FULL[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/**
 * D MMM YY (พ.ศ.) — e.g. "8 เม.ย. 69"
 */
export function formatThaiDateShort(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '-';
  const yearBE = (d.getFullYear() + 543) % 100;
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${pad(yearBE)}`;
}

/**
 * DD/MM/YYYY HH:mm (พ.ศ.) — e.g. "08/04/2569 14:30"
 */
export function formatThaiDateTime(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '-';
  return `${formatThaiDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert a พ.ศ. year to ค.ศ. (for parsing user input).
 */
export function beToAd(yearBE: number): number {
  return yearBE - 543;
}

/**
 * Convert a ค.ศ. year to พ.ศ.
 */
export function adToBe(yearAD: number): number {
  return yearAD + 543;
}

// Thai date formatting utilities (DD/MM/YYYY พ.ศ.)
//
// C5 fix (2026-05-14): all formatters extract day/month/year/hours/minutes via
// Asia/Bangkok timezone. The previous Date.getDate()/getMonth()/getFullYear()
// path used the SERVER's local timezone, which on Cloud Run = UTC. A receipt
// generated at 06:30 BKK (= 23:30 UTC previous day) printed YESTERDAY's date.

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function toDate(value: string | Date): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * C5 fix: extract Bangkok-local date parts. Uses Intl.DateTimeFormat with
 * en-CA locale because it returns ISO-like `YYYY-MM-DD HH:mm:ss` formatting
 * which is trivially parseable. Cloud Run defaults to UTC; without this,
 * receipts printed at 00:30 BKK = 17:30 UTC the previous day would show the
 * wrong calendar date (and wrong พ.ศ. on Dec 31 ↔ Jan 1 edge case).
 */
function bkkParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  // en-CA produces "YYYY-MM-DD, HH:mm:ss" — easy to slice without locale variance.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  // formatToParts is more reliable than format() string parsing across Node versions.
  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') lookup[p.type] = p.value;
  }
  return {
    year: Number(lookup.year),
    month: Number(lookup.month), // 1-12
    day: Number(lookup.day),
    // Intl may return "24" for midnight on some Node versions — normalise to 0.
    hour: Number(lookup.hour) === 24 ? 0 : Number(lookup.hour),
    minute: Number(lookup.minute),
  };
}

/** 03/03/2569 (DD/MM/YYYY พ.ศ. — Asia/Bangkok) */
export function formatDateShort(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  const p = bkkParts(d);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year + 543}`;
}

/** 03 มี.ค. 2569 (Asia/Bangkok) */
export function formatDateMedium(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  const p = bkkParts(d);
  return `${pad2(p.day)} ${THAI_MONTHS_SHORT[p.month - 1]} ${p.year + 543}`;
}

/** 3 เดือน มีนาคม พ.ศ. 2569 (Asia/Bangkok) */
export function formatDateLong(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  const p = bkkParts(d);
  return `${p.day} เดือน ${THAI_MONTHS[p.month - 1]} พ.ศ. ${p.year + 543}`;
}

/** มีนาคม (Asia/Bangkok) */
export function formatMonthName(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  const p = bkkParts(d);
  return THAI_MONTHS[p.month - 1];
}

/** 3 เม.ย. 2569 (no zero-padding — natural Thai text for messages, Asia/Bangkok) */
export function formatThaiDateText(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  const p = bkkParts(d);
  return `${p.day} ${THAI_MONTHS_SHORT[p.month - 1]} ${p.year + 543}`;
}

/** 03 มี.ค. (no year, Asia/Bangkok) */
export function formatDateShortThai(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  const p = bkkParts(d);
  return `${p.day} ${THAI_MONTHS_SHORT[p.month - 1]}`;
}

/** 03/03/2569 14:30 (Asia/Bangkok) */
export function formatDateTime(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  const p = bkkParts(d);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year + 543} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Extract Thai date components for contract templates (Asia/Bangkok). */
export function getThaiDateParts(value: string | Date): {
  day: string;
  month: string;
  monthShort: string;
  year: string;
  full: string;
  medium: string;
} {
  const d = toDate(value);
  if (!d) {
    return { day: '-', month: '-', monthShort: '-', year: '-', full: '-', medium: '-' };
  }
  const p = bkkParts(d);
  const buddhistYear = String(p.year + 543);
  return {
    day: String(p.day),
    month: THAI_MONTHS[p.month - 1],
    monthShort: THAI_MONTHS_SHORT[p.month - 1],
    year: buddhistYear,
    full: `${p.day} เดือน ${THAI_MONTHS[p.month - 1]} พ.ศ. ${buddhistYear}`,
    medium: `${pad2(p.day)} ${THAI_MONTHS_SHORT[p.month - 1]} ${buddhistYear}`,
  };
}

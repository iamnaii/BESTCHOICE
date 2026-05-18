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

export const THAI_MONTHS_SHORT = [
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
 * DD/MM/YYYY (ค.ศ.) — e.g. "08/04/2026"
 * Use when output must be Gregorian, not Buddhist (e.g. on print stickers).
 */
export function formatGregorianDate(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '-';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
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
 * HH:mm (24-hour) — e.g. "14:30"
 */
export function formatThaiTime(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '-';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

/**
 * D1.2.3.1 / D1.3.5.1 — Compute initial `{startDate, endDate}` ISO pair for a
 * list/summary page mount based on the OWNER-configured time-range preset
 * (`default_time_range` for generic list pages, `summary_default_range` for
 * the expense daily-summary page).
 *
 * - `'today'`      → today → today (D1.3.5.1)
 * - `'this_week'`  → Monday-of-this-week → today (D1.3.5.1, ISO week start)
 * - `'this_month'` → first-of-month → today (Asia/Bangkok)
 * - `'last_month'` → first-of-last-month → last-of-last-month
 * - `'all'`        → empty strings (the page query treats empty as "no filter")
 *
 * All computations anchor to Bangkok local date via `toLocaleDateString('sv-SE',
 * { timeZone: 'Asia/Bangkok' })` so late-night users on UTC servers see the
 * same boundary day they expect.
 */
export type DefaultTimeRangePreset = 'all' | 'today' | 'this_week' | 'this_month' | 'last_month';

export function computeDefaultTimeRange(
  preset: DefaultTimeRangePreset,
  now: Date = new Date(),
): { startDate: string; endDate: string } {
  if (preset === 'all') return { startDate: '', endDate: '' };
  const bkkToday = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  if (preset === 'today') {
    return { startDate: bkkToday, endDate: bkkToday };
  }
  if (preset === 'this_month') {
    return { startDate: `${bkkToday.slice(0, 7)}-01`, endDate: bkkToday };
  }
  if (preset === 'this_week') {
    // ISO week start (Monday). Compute day-of-week relative to UTC-indexed
    // copy of the BKK calendar day — day-of-week is timezone-invariant for
    // a given calendar date, so the BKK→UTC indexing trick used elsewhere
    // in this helper is safe here too.
    const [yStr, mStr, dStr] = bkkToday.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
    // Convert Sun=0 to ISO Sunday=7 so Monday=1 stays unchanged; "days since
    // last Monday" = isoDow - 1.
    const isoDow = dow === 0 ? 7 : dow;
    const daysSinceMonday = isoDow - 1;
    const monday = new Date(Date.UTC(y, m - 1, d - daysSinceMonday));
    const startDate = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
    return { startDate, endDate: bkkToday };
  }
  // 'last_month' — derive from the Bangkok-local year+month of `now`, then
  // subtract one month (handles January → previous-year December correctly).
  const [bkkYearStr, bkkMonthStr] = bkkToday.split('-');
  const bkkYear = Number(bkkYearStr);
  const bkkMonth = Number(bkkMonthStr); // 1-12
  const lastYear = bkkMonth === 1 ? bkkYear - 1 : bkkYear;
  const lastMonth = bkkMonth === 1 ? 12 : bkkMonth - 1;
  const lastMonthFirst = `${lastYear}-${String(lastMonth).padStart(2, '0')}-01`;
  // Last day of "last month" via the JS Date "day = 0" idiom (= last day of
  // the previous month). The day-count of any calendar month is timezone-
  // invariant, so building the date in UTC is safe even though the inputs
  // came from a BKK-local string.
  const lastDay = new Date(Date.UTC(bkkYear, bkkMonth - 1, 0)).getUTCDate();
  const lastMonthLast = `${lastYear}-${String(lastMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate: lastMonthFirst, endDate: lastMonthLast };
}

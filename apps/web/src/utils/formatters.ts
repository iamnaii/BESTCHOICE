// Thai date & number formatting utilities

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

// D1.2.3.3 — module-level date format preference. Pure formatter calls
// (used in excel exports, non-component code) need a global handle to the
// preference; `useUiFlags` syncs this via a `useEffect` at app boot.
// Default 'BE' so first-render output is identical to the pre-flag behaviour.
type DateFormatPreference = 'BE' | 'CE';
let dateFormatPreference: DateFormatPreference = 'BE';

/**
 * D1.2.3.3 — Set the global date format preference. Whitelist enforced;
 * unknown values are ignored. Called from `useUiFlags` on mount and on
 * SystemConfig changes.
 */
export function setDateFormatPreference(pref: DateFormatPreference): void {
  if (pref === 'BE' || pref === 'CE') {
    dateFormatPreference = pref;
  }
}

/**
 * D1.2.3.3 — Returns current effective year offset. BE = +543, CE = 0.
 */
function yearOffset(): number {
  return dateFormatPreference === 'CE' ? 0 : 543;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function parseDate(value: string | Date): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// date:s → 03/03/2569 (DD/MM/YYYY พ.ศ.) or 03/03/2026 (ค.ศ.) per D1.2.3.3.
export function formatDateShort(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + yearOffset()}`;
}

// date:m → 03 มี.ค. 2569 (BE) or 03 มี.ค. 2026 (CE) per D1.2.3.3.
export function formatDateMedium(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())} ${THAI_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + yearOffset()}`;
}

// date:l → "3 เดือน มีนาคม พ.ศ. 2569" (BE) or "3 เดือน มีนาคม ค.ศ. 2026" (CE).
// The era label ("พ.ศ." / "ค.ศ.") also flips with the preference so the
// document doesn't show "พ.ศ. 2026" — which would be incorrect.
export function formatDateLong(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  const eraLabel = dateFormatPreference === 'CE' ? 'ค.ศ.' : 'พ.ศ.';
  return `${d.getDate()} เดือน ${THAI_MONTHS[d.getMonth()]} ${eraLabel} ${d.getFullYear() + yearOffset()}`;
}

// date:month_name → มีนาคม
export function formatMonthName(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return THAI_MONTHS[d.getMonth()];
}

// date:st → short Thai date with no year
export function formatDateShortThai(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}`;
}

// date:dt → 03/03/2569 14:30 (BE) or 03/03/2026 14:30 (CE) per D1.2.3.3.
export function formatDateTime(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + yearOffset()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// date:dts → 03/03/2569 14:30:05 (BE) or 03/03/2026 14:30:05 (CE) per D1.2.3.3.
export function formatDateTimeSeconds(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + yearOffset()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// num → 21,468
export function formatNumber(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return String(value);
  return n.toLocaleString('th-TH');
}

// num:2 → 21,468.48
export function formatNumberDecimal(value: number | string, decimals = 2): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return String(value);
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Apply format pipe
export function applyFormat(value: unknown, format: string): string {
  if (value == null) return '';
  const fmt = format.trim();
  switch (fmt) {
    case 'date:s': return formatDateShort(String(value));
    case 'date:st': return formatDateShortThai(String(value));
    case 'date:m': return formatDateMedium(String(value));
    case 'date:l': return formatDateLong(String(value));
    case 'date:month_name': return formatMonthName(String(value));
    case 'date:dt': return formatDateTime(String(value));
    case 'date:dts': return formatDateTimeSeconds(String(value));
    case 'num': return formatNumber(value as number | string);
    default: {
      // Handle num:N pattern (e.g. num:0, num:2, num:3)
      const numMatch = fmt.match(/^num:(\d+)$/);
      if (numMatch) return formatNumberDecimal(value as number | string, parseInt(numMatch[1], 10));
      return String(value);
    }
  }
}

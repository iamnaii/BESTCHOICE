// Thai date & number formatting utilities

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

function parseDate(value: string | Date): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// date:s → 03/03/2569 (DD/MM/YYYY พ.ศ.)
export function formatDateShort(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543}`;
}

// date:m → 03 มี.ค. 2569
export function formatDateMedium(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())} ${THAI_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + 543}`;
}

// date:l → 3 เดือน มีนาคม พ.ศ. 2569
export function formatDateLong(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${d.getDate()} เดือน ${THAI_MONTHS[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
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

// date:dt → 03/03/2569 14:30 (DD/MM/YYYY พ.ศ. HH:mm)
export function formatDateTime(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// date:dts → 03/03/2569 14:30:05 (DD/MM/YYYY พ.ศ. HH:mm:ss)
export function formatDateTimeSeconds(value: string | Date): string {
  const d = parseDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
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
export function applyFormat(value: any, format: string): string {
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
    case 'num': return formatNumber(value);
    default: {
      // Handle num:N pattern (e.g. num:0, num:2, num:3)
      const numMatch = fmt.match(/^num:(\d+)$/);
      if (numMatch) return formatNumberDecimal(value, parseInt(numMatch[1], 10));
      return String(value);
    }
  }
}

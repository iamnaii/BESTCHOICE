// Thai date & number formatting utilities

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// date:s → 3/3/2569
export function formatDateShort(value: string): string {
  const d = parseDate(value);
  if (!d) return value;
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`;
}

// date:m → 3 มี.ค. 2569
export function formatDateMedium(value: string): string {
  const d = parseDate(value);
  if (!d) return value;
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + 543}`;
}

// date:l → 3 เดือน มีนาคม พ.ศ. 2569
export function formatDateLong(value: string): string {
  const d = parseDate(value);
  if (!d) return value;
  return `${d.getDate()} เดือน ${THAI_MONTHS[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
}

// date:month_name → มีนาคม
export function formatMonthName(value: string): string {
  const d = parseDate(value);
  if (!d) return value;
  return THAI_MONTHS[d.getMonth()];
}

// date:st → short Thai date with no year
export function formatDateShortThai(value: string): string {
  const d = parseDate(value);
  if (!d) return value;
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}`;
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
    case 'num': return formatNumber(value);
    default: {
      // Handle num:N pattern (e.g. num:0, num:2, num:3)
      const numMatch = fmt.match(/^num:(\d+)$/);
      if (numMatch) return formatNumberDecimal(value, parseInt(numMatch[1], 10));
      return String(value);
    }
  }
}

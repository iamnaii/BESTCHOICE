// Thai date formatting utilities (DD/MM/YYYY พ.ศ.)

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

/** 03/03/2569 (DD/MM/YYYY พ.ศ.) */
export function formatDateShort(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543}`;
}

/** 03 มี.ค. 2569 */
export function formatDateMedium(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())} ${THAI_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/** 3 เดือน มีนาคม พ.ศ. 2569 */
export function formatDateLong(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return `${d.getDate()} เดือน ${THAI_MONTHS[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
}

/** มีนาคม */
export function formatMonthName(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return THAI_MONTHS[d.getMonth()];
}

/** 3 เม.ย. 2569 (no zero-padding — natural Thai text for messages) */
export function formatThaiDateText(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/** 03 มี.ค. (no year) */
export function formatDateShortThai(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}`;
}

/** 03/03/2569 14:30 */
export function formatDateTime(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Extract Thai date components for contract templates */
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
  const buddhistYear = String(d.getFullYear() + 543);
  return {
    day: String(d.getDate()),
    month: THAI_MONTHS[d.getMonth()],
    monthShort: THAI_MONTHS_SHORT[d.getMonth()],
    year: buddhistYear,
    full: `${d.getDate()} เดือน ${THAI_MONTHS[d.getMonth()]} พ.ศ. ${buddhistYear}`,
    medium: `${pad2(d.getDate())} ${THAI_MONTHS_SHORT[d.getMonth()]} ${buddhistYear}`,
  };
}

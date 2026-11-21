export function parseThaiDateTime(raw: string): Date {
  const t = (raw ?? '').trim();
  // ISO already (exceljs may hand back a Date -> toISOString upstream)
  if (t.includes('T')) return new Date(t);
  // "YYYY-MM-DD HH:mm:ss" — treat as Asia/Bangkok (+07:00)
  return new Date(t.replace(' ', 'T') + '+07:00');
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Excel dates are timezone-free wall times; the export's calendar is Asia/Bangkok.
export function sourceTimestamp(cell: string | undefined): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(
      (cell ?? '').trim(),
    );
  if (!match) return null;
  const [, day, hours, minutes, seconds, fraction = '', offset] = match;
  if (!isCalendarDay(day) || +hours > 23 || +minutes > 59 || +seconds > 59) return null;
  const date = new Date(`${day}T${hours}:${minutes}:${seconds}${fraction}${offset ?? '+07:00'}`);
  if (!Number.isFinite(date.getTime())) return null;
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString();
  return local.replace(/(?:\.000)?Z$/, '+07:00');
}

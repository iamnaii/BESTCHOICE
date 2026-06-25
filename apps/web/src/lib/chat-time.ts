import { differenceInCalendarDays, isSameDay, format } from 'date-fns';
import { th } from 'date-fns/locale';

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** Compact relative timestamp for conversation-list rows (Thai). */
export function formatChatTimestamp(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'เมื่อสักครู่'; // covers small future clock skew (diffMin < 0)
  if (diffMin < 60) return `${diffMin} นาที`;
  if (isSameDay(d, now)) return `${Math.floor(diffMin / 60)} ชม.`;
  if (differenceInCalendarDays(now, d) === 1) return 'เมื่อวาน';
  if (d.getFullYear() === now.getFullYear()) return format(d, 'd MMM', { locale: th });
  return format(d, 'd MMM yy', { locale: th });
}

/** Day-divider label for the message thread (Thai). */
export function formatDateSeparator(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  const days = differenceInCalendarDays(now, d);
  if (days === 0) return 'วันนี้';
  if (days === 1) return 'เมื่อวาน';
  if (d.getFullYear() === now.getFullYear()) return format(d, 'd MMMM', { locale: th });
  return format(d, 'd MMMM yyyy', { locale: th });
}

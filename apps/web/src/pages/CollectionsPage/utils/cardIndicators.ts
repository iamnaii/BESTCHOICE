export type AgingBucket = '1-7' | '8-30' | '31-60' | '61-90' | '90+';

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 7) return '1-7';
  if (daysOverdue <= 30) return '8-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

export function agingColor(bucket: AgingBucket): string {
  switch (bucket) {
    case '1-7':
      return 'bg-success/15 text-success border-success/30';
    case '8-30':
      return 'bg-warning/15 text-warning border-warning/30';
    case '31-60':
      // No semantic "orange" token — reuse warning with stronger emphasis
      return 'bg-warning/25 text-warning border-warning/40';
    case '61-90':
      return 'bg-destructive/15 text-destructive border-destructive/30';
    case '90+':
      return 'bg-destructive/30 text-destructive border-destructive/50';
  }
}

export function formatRelativeTime(date: Date | string | null): string {
  if (!date) return 'ไม่เคย';
  const ts = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - ts.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'เมื่อสักครู่';
  if (diffMin < 60) return `${diffMin} นาที`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชม.`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} วัน`;
}

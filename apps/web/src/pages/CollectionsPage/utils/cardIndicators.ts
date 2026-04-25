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
      return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30';
    case '8-30':
      return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
    case '31-60':
      return 'bg-orange-500/15 text-orange-700 border-orange-500/30';
    case '61-90':
      return 'bg-red-500/15 text-red-700 border-red-500/30';
    case '90+':
      return 'bg-purple-500/15 text-purple-700 border-purple-500/30';
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

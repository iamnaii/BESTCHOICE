import type { BuybackQuoteResult } from '@/types/buyback';

export function validQuoteWindow(quote: BuybackQuoteResult) {
  const start = Date.parse(quote.assessedAt ?? '');
  const end = Date.parse(quote.expiresAt ?? '');
  const now = Date.parse(quote.serverNow ?? '');
  return (
    !!quote.quoteToken &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(now) &&
    end - start === 86_400_000 &&
    now >= start &&
    now < end
  );
}

export function quoteDate(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'ไม่ทราบเวลา';
  return (
    new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value)) + ' น.'
  );
}

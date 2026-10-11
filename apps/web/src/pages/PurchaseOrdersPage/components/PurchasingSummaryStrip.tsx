import { Card, CardContent } from '@/components/ui/card';
import AnimatedCounter from '@/components/ui/animated-counter';
import { cn } from '@/lib/utils';
import { SUMMARY_CARDS, TONE_STYLES, type PurchasingSummary, type SummaryFilterAction } from '../summaryStrip';

interface PurchasingSummaryStripProps {
  summary: PurchasingSummary | undefined;
  onCardClick: (action: SummaryFilterAction) => void;
  /** ดูอย่างเดียว (ผจก.การเงิน / ฝ่ายบัญชี): การ์ดที่พาไปหน้าอื่นซึ่ง role นี้เข้าไม่ได้ (รอถ่ายรูป → /purchase-orders/qc) แสดงตัวเลขแต่กดไม่ได้ */
  readOnly?: boolean;
}

export function PurchasingSummaryStrip({ summary, onCardClick, readOnly = false }: PurchasingSummaryStripProps) {
  // No data yet (loading) or the B0 endpoint is unavailable → render nothing rather than crash.
  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 lg:gap-4 mb-5">
      {SUMMARY_CARDS.map((card) => {
        const Icon = card.icon;
        const styles = TONE_STYLES[card.tone];
        const count = summary[card.key] ?? 0;
        const locked = readOnly && 'panel' in card.action;
        return (
          <button
            key={card.key}
            type="button"
            disabled={locked}
            onClick={() => onCardClick(card.action)}
            aria-label={locked ? `${card.label}: ${count} รายการ` : `${card.label}: ${count} รายการ — คลิกเพื่อกรอง`}
            className="text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl disabled:cursor-default"
          >
            <Card className={cn('group overflow-hidden h-full transition-all duration-200', locked ? '' : 'cursor-pointer hover:shadow-md hover:-translate-y-0.5')}>
              <CardContent className="p-4 relative">
                <div className={cn('absolute inset-y-0 left-0 w-1 rounded-l-xl', styles.border)} />
                <div className="pl-2">
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={cn(
                        'size-10 rounded-xl flex items-center justify-center transition-colors',
                        styles.iconBox,
                      )}
                    >
                      <Icon className={cn('size-5', styles.icon)} />
                    </div>
                    {count > 0 && (
                      <span className={cn('text-2xs font-semibold px-2 py-0.5 rounded-full', styles.pill)}>
                        {count}
                      </span>
                    )}
                  </div>
                  <AnimatedCounter value={count} className="text-2xl font-bold text-foreground" />
                  <div className="text-xs font-medium text-muted-foreground mt-1 leading-snug">{card.label}</div>
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}

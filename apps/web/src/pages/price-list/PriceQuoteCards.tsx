import { RATE1_TITLE, RATE2_TITLE, formatCash, rate1View, rate2View, rowLabel, rowTitle } from './format';
import { RateBlock, WarrantyBadge } from './parts';
import type { PriceQuoteRow } from './types';

/** จอแคบกว่า 1024px — การ์ดละรุ่น + ความจุ (ตาม mockup staff-price-page.html) */
export default function PriceQuoteCards({ rows }: { rows: PriceQuoteRow[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <article
            aria-label={rowLabel(row)}
            className="rounded-xl border border-border bg-card p-3 shadow-card"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold leading-snug text-foreground">
                <span>{rowTitle(row)}</span>
                <WarrantyBadge hasWarranty={row.hasWarranty} />
              </h2>
              <p className="text-sm leading-snug text-muted-foreground tabular-nums">
                เงินสด <span className="text-base font-semibold text-foreground">{formatCash(row.cashPrice)}</span>
              </p>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <RateBlock title={RATE1_TITLE} view={rate1View(row.rate1)} />
              <RateBlock title={RATE2_TITLE} view={rate2View(row.rate2)} />
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

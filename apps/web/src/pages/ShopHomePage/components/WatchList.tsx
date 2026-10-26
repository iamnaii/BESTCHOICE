import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import type { ShopHomeWatchItem } from '../types';
import { baht } from '../format';
import { SEVERITY_CHIP_CLASS, SEVERITY_LABEL, WATCH_LABEL, watchHref } from '../watch-links';

const ROW_CLASS =
  'flex items-center gap-3 min-h-12 px-3 py-2 rounded-lg text-[14px] text-foreground';

/** "สิ่งที่ต้องดูวันนี้" — แถวเป็นลิงก์เฉพาะบทบาทที่เปิดหน้าปลายทางได้ ชิปมีคำกำกับเสมอ */
export default function WatchList({ items, role }: { items: ShopHomeWatchItem[]; role: string }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">สิ่งที่ต้องดูวันนี้</h2>
        <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          {items.length} เรื่อง
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">ไม่มีงานค้าง วันนี้ว่าง</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const href = watchHref(item.key, role);
            const body = (
              <>
                <span
                  className={`inline-flex items-baseline gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-bold tabular-nums ${SEVERITY_CHIP_CLASS[item.severity]}`}
                >
                  {item.count}
                  <small className="text-[11px] font-semibold">{SEVERITY_LABEL[item.severity]}</small>
                </span>
                <span className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2">
                  <span>{WATCH_LABEL[item.key]}</span>
                  {item.key === 'AGING_90' && item.costValue != null && (
                    <span className="text-xs text-muted-foreground tabular-nums">{`ทุนจม ${baht(item.costValue)} ฿`}</span>
                  )}
                  {item.detail && <span className="text-xs text-muted-foreground">{`· ${item.detail}`}</span>}
                </span>
                {href && <ChevronRight className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />}
              </>
            );
            return (
              <li key={item.key}>
                {href ? (
                  <Link to={href} className={`${ROW_CLASS} hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring`}>
                    {body}
                  </Link>
                ) : (
                  <div className={ROW_CLASS}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground mt-auto pt-2 border-t border-border">
        รายการนี้มาจากเงื่อนไขที่ตั้งไว้ (จุดสั่งซื้อซ้ำ · 90 วัน · สถานะเครื่อง)
      </p>
    </section>
  );
}

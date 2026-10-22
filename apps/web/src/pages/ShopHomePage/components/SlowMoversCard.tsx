import { Link } from 'react-router';
import type { ShopHomeResponse } from '../types';
import { baht } from '../format';

interface Props {
  slowMovers: ShopHomeResponse['slowMovers'];
  stockAging: ShopHomeResponse['stockAging'];
}

const AGING_TONE = ['text-primary', 'text-warning-strong', 'text-warning-strong', 'text-destructive'];
const ALL_AGING_HREF = '/stock/products?sortBy=stockInDate&sortDirection=asc';

/** ค้างสต๊อกนานสุด 5 อันดับ + ช่วงอายุสต๊อก — "ทุน" แสดงเฉพาะเมื่อ server ส่งมา (ไม่ใช่ SALES) */
export default function SlowMoversCard({ slowMovers, stockAging }: Props) {
  const over90 = stockAging.find((b) => b.label.startsWith('90'))?.count ?? stockAging[3]?.count ?? 0;

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">ค้างสต๊อกนานสุด</h2>
        <Link to={ALL_AGING_HREF} className="text-xs text-primary hover:underline">
          {`ดูทั้งหมด ${over90} เครื่อง ›`}
        </Link>
      </div>

      {slowMovers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มีสินค้าค้างเกิน 30 วัน</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {slowMovers.map((item, i) => {
            const hot = item.days > 90;
            return (
              <li key={`${item.name}-${i}`} className="flex items-center gap-2.5 text-[13px]">
                <span
                  className={`size-6 rounded-md inline-flex items-center justify-center text-[11px] font-bold tabular-nums ${
                    hot ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning-strong'
                  }`}
                >
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 truncate" title={item.name}>
                  {item.name}
                </span>
                {item.costPrice != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">{`ทุน ${baht(item.costPrice)}`}</span>
                )}
                <span className={`font-bold tabular-nums ${hot ? 'text-destructive' : 'text-warning-strong'}`}>
                  {item.days} <span className="font-normal text-muted-foreground">วัน</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-auto pt-2 border-t border-border text-xs text-muted-foreground tabular-nums">
        <span>อายุสต๊อก:</span>
        {stockAging.map((b, i) => (
          <span key={b.label}>
            <b className={AGING_TONE[i] ?? ''}>{b.count}</b> · {b.label.replace(' วัน', '')}
          </span>
        ))}
      </div>
    </section>
  );
}

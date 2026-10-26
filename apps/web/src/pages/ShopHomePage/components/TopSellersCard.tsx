import { useState } from 'react';
import { Link } from 'react-router';
import { categoryLabels } from '@/lib/constants';
import type { ShopHomeResponse } from '../types';

type Tab = 'model' | 'category';

const TAB_CLASS =
  'min-h-9 px-3.5 rounded-full border text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

/** ขายดี 30 วัน — สลับดูตามรุ่น/ตามหมวด แถบสัดส่วนเทียบอันดับ 1 */
export default function TopSellersCard({ data }: { data: ShopHomeResponse['topSellers30d'] }) {
  const [tab, setTab] = useState<Tab>('model');
  const rows = tab === 'model' ? data.byModel : data.byCategory;
  const max = rows[0]?.count ?? 0;

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">ขายดี 30 วัน</h2>
        <div className="flex gap-1.5" role="group" aria-label="มุมมองขายดี">
          {(
            [
              ['model', 'ตามรุ่น'],
              ['category', 'ตามหมวด'],
            ] as const
          ).map(([key, label]) => {
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setTab(key)}
                className={`${TAB_CLASS} ${on ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground border-border'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มีการขายใน 30 วันที่ผ่านมา</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const pct = max > 0 ? Math.max((row.count / max) * 100, 2) : 0;
            const label = tab === 'category' ? (categoryLabels[row.name] ?? row.name) : row.name;
            return (
              <li key={row.name} className="flex items-center gap-2.5 text-[13px]">
                {tab === 'model' ? (
                  <Link
                    to={`/stock/products?q=${encodeURIComponent(row.name)}`}
                    className="w-[150px] shrink-0 truncate text-foreground hover:text-primary"
                    title={row.name}
                  >
                    {label}
                  </Link>
                ) : (
                  <span className="w-[150px] shrink-0 truncate" title={label}>
                    {label}
                  </span>
                )}
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right font-semibold tabular-nums">{row.count}</span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground mt-auto">นับจากรายการขายที่ไม่ถูกยกเลิก · กดชื่อรุ่นไปหน้ารายการสินค้าที่กรองรุ่นนั้น</p>
    </section>
  );
}

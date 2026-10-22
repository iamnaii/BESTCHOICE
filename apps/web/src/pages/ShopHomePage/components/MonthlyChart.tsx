import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ShopHomeResponse } from '../types';
import { baht, monthLabel, signedPct } from '../format';

interface Props {
  monthly: ShopHomeResponse['monthly'];
  thisMonth: ShopHomeResponse['thisMonth'];
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'up' | 'down' }) {
  const toneClass = tone === 'up' ? 'text-primary' : tone === 'down' ? 'text-destructive' : '';
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`text-[22px] font-bold tabular-nums leading-tight ${toneClass}`}>{value}</div>
    </div>
  );
}

const MOM_LABEL = 'เทียบเดือนก่อนทั้งเดือน';

/**
 * กราฟยอดขาย · ต้นทุน · กำไรขั้นต้น (1–6 เดือน) — ต้นทุนเป็นแท่งลายเส้นเพื่อไม่ให้ต่างกันด้วยสีอย่างเดียว
 * เมื่อ server ตัดต้นทุนออก (SALES) เหลือยอดขายอย่างเดียวทั้งหัวการ์ด ตัวเลข และแท่ง
 */
export default function MonthlyChart({ monthly, thisMonth }: Props) {
  const showCost = thisMonth.cost != null;
  const data = monthly.map((m) => ({
    month: monthLabel(m.month),
    ยอดขาย: m.sales,
    ต้นทุน: m.cost ?? 0,
    กำไรขั้นต้น: m.grossProfit ?? 0,
  }));
  const momTone = (pct: number | null) => (pct == null ? undefined : pct >= 0 ? 'up' : 'down');

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          {showCost ? 'ยอดขาย · ต้นทุน · กำไรขั้นต้น 6 เดือน' : 'ยอดขาย 6 เดือน'}
        </h2>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" aria-hidden="true" />
            ยอดขาย
          </span>
          {showCost && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm border border-muted-foreground"
                style={{ backgroundImage: 'repeating-linear-gradient(135deg, hsl(var(--muted-foreground)) 0 1px, transparent 1px 3px)' }}
                aria-hidden="true"
              />
              ต้นทุน (ลายเส้น)
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        {showCost ? (
          <>
            <Stat
              label="กำไรขั้นต้นเดือนนี้"
              value={
                <>
                  <span>{baht(thisMonth.grossProfit ?? 0)}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {` ฿${thisMonth.grossMarginPct != null ? ` · ${thisMonth.grossMarginPct}%` : ''}`}
                  </span>
                </>
              }
            />
            {thisMonth.grossProfitMomPct != null && (
              <Stat label={MOM_LABEL} value={signedPct(thisMonth.grossProfitMomPct)} tone={momTone(thisMonth.grossProfitMomPct)} />
            )}
            <Stat
              label="ต้นทุนขาย"
              value={
                <>
                  <span>{baht(thisMonth.cost ?? 0)}</span>
                  <span className="text-xs font-normal text-muted-foreground"> ฿</span>
                </>
              }
            />
          </>
        ) : (
          <>
            <Stat
              label="ยอดขายเดือนนี้"
              value={
                <>
                  <span>{baht(thisMonth.sales)}</span>
                  <span className="text-xs font-normal text-muted-foreground"> ฿</span>
                </>
              }
            />
            {thisMonth.salesMomPct != null && (
              <Stat label={MOM_LABEL} value={signedPct(thisMonth.salesMomPct)} tone={momTone(thisMonth.salesMomPct)} />
            )}
          </>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="h-56 min-w-105 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <pattern id="shop-home-cost-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="hsl(var(--muted))" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--muted-foreground))" strokeWidth="2" />
                </pattern>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                formatter={(value) => `${baht(Number(value ?? 0))} ฿`}
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Bar dataKey="ยอดขาย" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              {showCost && (
                <Bar
                  dataKey="ต้นทุน"
                  fill="url(#shop-home-cost-hatch)"
                  stroke="hsl(var(--muted-foreground))"
                  radius={[4, 4, 0, 0]}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {showCost && (
        <p className="text-xs text-muted-foreground">
          กำไรขั้นต้น = ยอดขายหน้าร้าน − ต้นทุนเครื่องที่ขาย (จากงบ SHOP รายเดือน) ไม่รวมค่าใช้จ่ายดำเนินงาน
        </p>
      )}
    </section>
  );
}

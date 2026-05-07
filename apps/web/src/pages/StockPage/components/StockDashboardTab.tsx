import { StockDashboard } from '../types';
import { statusLabels, categoryLabels } from '@/lib/constants';
import {
  AlertTriangle,
  BarChart3,
  Clock,
  HardDrive,
  Package,
  Palette,
  PieChart as PieChartIcon,
  Tag,
  Trophy,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const SLOW_MOVER_MIN_DAYS = 30;

export interface StockDashboardTabProps {
  dashboard: StockDashboard | undefined;
  isManager: boolean;
}

function SectionTitle({ icon, children, hint }: { icon?: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="text-[14px] font-semibold flex items-center gap-2">
        {icon && <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>}
        {children}
      </h2>
      {hint && (
        <span className="text-[11px] text-muted-foreground font-mono tracking-wider uppercase">{hint}</span>
      )}
    </div>
  );
}

function BarInline({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span className="w-20 truncate text-[12px] text-muted-foreground" title={label}>{label}</span>
      <div className="flex-1 bg-muted/60 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="w-7 text-right text-[12px] tabular-nums font-medium">{count}</span>
    </div>
  );
}

const STATUS_BAR_COLOR: Record<string, string> = {
  IN_STOCK: 'bg-success',
  SOLD_INSTALLMENT: 'bg-primary',
  SOLD_CASH: 'bg-primary/70',
  RESERVED: 'bg-warning',
  QC_PENDING: 'bg-warning/70',
  PHOTO_PENDING: 'bg-warning/70',
  REPOSSESSED: 'bg-destructive',
};

export function StockDashboardTab({ dashboard, isManager }: StockDashboardTabProps) {
  if (!dashboard) {
    return (
      <div className="rounded-xl border border-border/60 p-8 text-center text-muted-foreground">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary mx-auto mb-3" />
        กำลังโหลด Dashboard...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stock Aging buckets — 4 across */}
      <div className="rounded-xl border border-border/60 p-4 bg-card">
        <SectionTitle icon={<Clock />} hint="aging">อายุสต็อค</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {dashboard.stockAging.map((bucket, i) => {
            const colors = ['border-l-success', 'border-l-warning', 'border-l-warning', 'border-l-destructive'];
            const textColors = ['text-success', 'text-warning', 'text-warning', 'text-destructive'];
            return (
              <div key={bucket.label} className={`bg-muted/40 rounded-lg p-3 border-l-4 ${colors[i]}`}>
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {bucket.label}
                </div>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className={`text-2xl font-bold tabular-nums ${bucket.count > 0 ? textColors[i] : ''}`}>
                    {bucket.count}
                  </span>
                  <span className="text-[11px] text-muted-foreground">ชิ้น</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                  {bucket.value.toLocaleString()} ฿
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Row: Value by Status + Stock Movement chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Value by Status */}
        <div className="rounded-xl border border-border/60 p-4 bg-card">
          <SectionTitle icon={<PieChartIcon />} hint="by status">มูลค่าสต็อคตามสถานะ</SectionTitle>
          {(() => {
            const total = dashboard.valueByStatus.reduce((s, i) => s + i.value, 0);
            if (total === 0) {
              return <div className="text-sm text-muted-foreground text-center py-6">ยังไม่มีข้อมูล</div>;
            }
            return (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted mb-4">
                  {dashboard.valueByStatus.map((item) => {
                    const pct = (item.value / total) * 100;
                    const color = STATUS_BAR_COLOR[item.status] ?? 'bg-muted-foreground';
                    return (
                      <div
                        key={item.status}
                        className={color}
                        style={{ width: `${pct}%` }}
                        title={`${statusLabels[item.status]?.label ?? item.status}: ${pct.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  {dashboard.valueByStatus.map((item) => {
                    const s = statusLabels[item.status] || { label: item.status, className: 'bg-muted text-foreground' };
                    const pct = (item.value / total) * 100;
                    const dotColor = STATUS_BAR_COLOR[item.status] ?? 'bg-muted-foreground';
                    return (
                      <div key={item.status} className="flex items-center justify-between py-1 text-[13px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`size-2 rounded-full shrink-0 ${dotColor}`} />
                          <span className="text-foreground truncate">{s.label}</span>
                          <span className="text-muted-foreground/80 text-[11px] tabular-nums">
                            {item.count}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {pct.toFixed(0)}%
                          </span>
                          <span className="font-medium tabular-nums">
                            {item.value.toLocaleString()} ฿
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-border text-[13px] font-semibold">
                    <span>รวม</span>
                    <span className="tabular-nums">{total.toLocaleString()} ฿</span>
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        {/* Stock Movement chart */}
        <div className="rounded-xl border border-border/60 p-4 bg-card">
          <SectionTitle icon={<BarChart3 />} hint="6 mo">การเคลื่อนไหวสต็อค</SectionTitle>
          {(() => {
            const firstNonZero = dashboard.stockMovement.findIndex((m) => m.in > 0 || m.out > 0);
            const data = firstNonZero === -1 ? [] : dashboard.stockMovement.slice(firstNonZero);

            if (data.length === 0) {
              return (
                <div className="text-sm text-muted-foreground text-center py-10">
                  ยังไม่มีการเคลื่อนไหว
                </div>
              );
            }
            return (
              <div className="h-56 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Bar dataKey="in" name="รับเข้า" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="out" name="ขายออก" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Breakdowns: Category / Brand / Color / Storage */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border/60 p-4 bg-card">
          <SectionTitle icon={<Package />} hint="type">ตามประเภท</SectionTitle>
          <div className="space-y-2">
            {dashboard.byCategory.map((item) => (
              <BarInline
                key={item.name}
                label={categoryLabels[item.name] || item.name}
                count={item.count}
                total={dashboard.stockTurnover.currentStock}
                color="bg-primary"
              />
            ))}
            {dashboard.byCategory.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">—</div>}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 p-4 bg-card">
          <SectionTitle icon={<Tag />} hint="brand">ตามแบรนด์</SectionTitle>
          <div className="space-y-2">
            {dashboard.byBrand.slice(0, 8).map((item) => (
              <BarInline
                key={item.name}
                label={item.name}
                count={item.count}
                total={dashboard.stockTurnover.currentStock}
                color="bg-primary"
              />
            ))}
            {dashboard.byBrand.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">—</div>}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 p-4 bg-card">
          <SectionTitle icon={<Palette />} hint="color">ตามสี</SectionTitle>
          <div className="space-y-2">
            {dashboard.byColor.slice(0, 8).map((item) => (
              <BarInline
                key={item.name}
                label={item.name}
                count={item.count}
                total={dashboard.stockTurnover.currentStock}
                color="bg-primary/60"
              />
            ))}
            {dashboard.byColor.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">—</div>}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 p-4 bg-card">
          <SectionTitle icon={<HardDrive />} hint="storage">ตามความจุ</SectionTitle>
          <div className="space-y-2">
            {dashboard.byStorage.slice(0, 8).map((item) => (
              <BarInline
                key={item.name}
                label={item.name}
                count={item.count}
                total={dashboard.stockTurnover.currentStock}
                color="bg-success/60"
              />
            ))}
            {dashboard.byStorage.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">—</div>}
          </div>
        </div>
      </div>

      {/* Top Sellers + Slow Movers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/60 p-4 bg-card">
          <SectionTitle icon={<Trophy />} hint="6 mo">สินค้าขายดี</SectionTitle>
          {dashboard.topSellers.length > 0 ? (
            <div className="space-y-2">
              {dashboard.topSellers.map((item, i) => (
                <div key={item.name} className="flex items-center gap-3">
                  <span
                    className={`size-6 rounded-md flex items-center justify-center text-[11px] font-mono font-bold tabular-nums ${
                      i === 0
                        ? 'bg-warning/15 text-warning'
                        : i === 1
                          ? 'bg-muted text-foreground'
                          : i === 2
                            ? 'bg-warning/10 text-warning/80'
                            : 'bg-muted/60 text-muted-foreground'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0 text-[13px] font-medium truncate">{item.name}</div>
                  <span className="text-[12px] font-bold text-primary tabular-nums">
                    {item.count} <span className="font-normal text-muted-foreground">ชิ้น</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">ยังไม่มีข้อมูลการขาย</div>
          )}
        </div>

        <div className="rounded-xl border border-border/60 p-4 bg-card">
          <SectionTitle icon={<AlertTriangle />} hint="slow">สินค้าค้างสต็อคนานสุด</SectionTitle>
          {(() => {
            const slow = dashboard.slowMovers.filter((i) => i.days >= SLOW_MOVER_MIN_DAYS);
            if (slow.length === 0) {
              return (
                <div className="text-sm text-muted-foreground text-center py-4">
                  ยังไม่มีสินค้าค้างเกิน {SLOW_MOVER_MIN_DAYS} วัน
                </div>
              );
            }
            return (
              <div className="space-y-2">
                {slow.map((item, i) => (
                  <div key={`${item.name}-${i}`} className="flex items-center gap-3">
                    <span
                      className={`size-6 rounded-md flex items-center justify-center text-[11px] font-mono font-bold tabular-nums ${
                        item.days > 90 ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">{item.name}</div>
                      {isManager && (
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {(Number(item.costPrice) || 0).toLocaleString()} ฿
                        </div>
                      )}
                    </div>
                    <span
                      className={`text-[12px] font-bold tabular-nums ${
                        item.days > 90 ? 'text-destructive' : 'text-warning'
                      }`}
                    >
                      {item.days} <span className="font-normal text-muted-foreground">วัน</span>
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

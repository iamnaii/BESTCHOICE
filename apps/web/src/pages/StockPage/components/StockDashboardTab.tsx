import { StockDashboard } from '../types';
import { statusLabels, categoryLabels } from '@/lib/constants';
import AnimatedCounter from '@/components/ui/animated-counter';
import { formatDateShort } from '@/utils/formatters';
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
  TrendingUp,
  Wallet,
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

// Slow-mover threshold — only highlight items that have been sitting for at least this many days.
// Below this, the list would just echo the newest arrivals and carry no signal.
const SLOW_MOVER_MIN_DAYS = 30;

export interface StockDashboardTabProps {
  dashboard: StockDashboard | undefined;
  isManager: boolean;
  actionTotal: number;
  warrantyExpiring: { id: string; name: string; brand: string; model: string; warrantyExpireDate: string }[];
}

// --- Small Reusable Components (only used in dashboard) ---

function SectionTitle({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
      {icon && <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>}
      {children}
    </h2>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: React.ReactNode; accent?: string }) {
  return (
    <div className={`rounded-xl border p-4 transition-shadow hover:shadow-xs ${accent ? `border-l-4 ${accent}` : ''}`}>
      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
      <div className="text-xl font-bold text-foreground">
        {typeof value === 'number' ? <AnimatedCounter value={value} /> : value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function BarInline({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 truncate text-muted-foreground" title={label}>{label}</span>
      <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="w-8 text-right text-foreground font-medium">{count}</span>
    </div>
  );
}

// Status → Tailwind bg color for the stacked bar. Falls back to muted-foreground.
const STATUS_BAR_COLOR: Record<string, string> = {
  IN_STOCK: 'bg-success',
  SOLD_INSTALLMENT: 'bg-primary',
  SOLD_CASH: 'bg-primary/70',
  RESERVED: 'bg-warning',
  QC_PENDING: 'bg-warning/70',
  PHOTO_PENDING: 'bg-warning/70',
  REPOSSESSED: 'bg-destructive',
};

function MoMBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    return <span className="text-xs text-muted-foreground">เริ่มบันทึกข้อมูลเดือนนี้</span>;
  }
  const delta = ((current - previous) / previous) * 100;
  const up = delta >= 0;
  const color = up ? 'text-success' : 'text-destructive';
  return (
    <span className={`text-xs font-medium ${color}`}>
      {up ? '+' : ''}
      {delta.toFixed(0)}% MoM
    </span>
  );
}

export function StockDashboardTab({ dashboard, isManager, actionTotal, warrantyExpiring }: StockDashboardTabProps) {
  return (
    <>
      {warrantyExpiring.length > 0 && (
        <div className="bg-warning/5 dark:bg-warning/10 border border-warning/20 rounded-xl p-4 mb-4">
          <div className="text-sm font-medium text-warning flex items-center gap-2">
            <AlertTriangle className="size-4" />
            รับประกันใกล้หมด: {warrantyExpiring.length} รายการ
          </div>
          <div className="mt-2 space-y-1">
            {warrantyExpiring.slice(0, 5).map(p => (
              <div key={p.id} className="text-xs text-warning/80 flex justify-between">
                <span>{p.brand} {p.model}</span>
                <span>{formatDateShort(p.warrantyExpireDate)}</span>
              </div>
            ))}
            {warrantyExpiring.length > 5 && <div className="text-xs text-warning/70">...และอีก {warrantyExpiring.length - 5} รายการ</div>}
          </div>
        </div>
      )}

      {dashboard && (
        <div className="flex flex-col gap-5 lg:gap-7.5">

          {/* Row 1: Action Required + Stock Turnover */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5">
            {/* Action Required */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<AlertTriangle />}>รอดำเนินการ ({actionTotal})</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                {dashboard.actionRequired.inspection > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-warning/5 dark:bg-warning/10 rounded-xl">
                    <div className="w-10 h-10 bg-warning/10 rounded-xl flex items-center justify-center text-warning text-lg font-bold">
                      {dashboard.actionRequired.inspection}
                    </div>
                    <div className="text-sm text-warning">รอตรวจสอบ</div>
                  </div>
                )}
                {(dashboard.actionRequired.photoPending || 0) > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-primary/5 dark:bg-primary/10 rounded-xl">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary text-lg font-bold">
                      {dashboard.actionRequired.photoPending}
                    </div>
                    <div className="text-sm text-primary">รอถ่ายรูป</div>
                  </div>
                )}
                {dashboard.actionRequired.pendingTransfers > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-primary/5 dark:bg-primary/10 rounded-xl">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary text-lg font-bold">
                      {dashboard.actionRequired.pendingTransfers}
                    </div>
                    <div className="text-sm text-primary">รอยืนยันโอน</div>
                  </div>
                )}
                {dashboard.actionRequired.repossessed > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-destructive/5 dark:bg-destructive/10 rounded-xl">
                    <div className="w-10 h-10 bg-destructive/10 rounded-xl flex items-center justify-center text-destructive text-lg font-bold">
                      {dashboard.actionRequired.repossessed}
                    </div>
                    <div className="text-sm text-destructive">ยึดคืน รอปรับสภาพ</div>
                  </div>
                )}
                {dashboard.actionRequired.agingOver90 > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-warning/5 dark:bg-warning/10 rounded-xl">
                    <div className="w-10 h-10 bg-warning/10 rounded-xl flex items-center justify-center text-warning text-lg font-bold">
                      {dashboard.actionRequired.agingOver90}
                    </div>
                    <div className="text-sm text-warning">ค้างสต๊อค 90+ วัน</div>
                  </div>
                )}
                {actionTotal === 0 && (
                  <div className="col-span-2 text-center text-sm text-muted-foreground py-4">ไม่มีรายการรอดำเนินการ</div>
                )}
              </div>
            </div>

            {/* Stock Turnover */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<TrendingUp />}>อัตราหมุนเวียนสต๊อค</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <StatCard label="อายุเฉลี่ยในสต๊อค" value={`${dashboard.stockTurnover.avgDaysInStock} วัน`} accent="border-l-primary" />
                <StatCard label="สต๊อคปัจจุบัน" value={dashboard.stockTurnover.currentStock} sub="ชิ้น (IN_STOCK)" accent="border-l-success" />
                <StatCard label="ขายเดือนนี้" value={dashboard.stockTurnover.soldThisMonth} sub="ชิ้น" accent="border-l-primary" />
                <StatCard
                  label="ขายเดือนที่แล้ว"
                  value={dashboard.stockTurnover.soldLastMonth}
                  sub={
                    <MoMBadge
                      current={dashboard.stockTurnover.soldThisMonth}
                      previous={dashboard.stockTurnover.soldLastMonth}
                    />
                  }
                  accent="border-l-muted-foreground"
                />
              </div>
            </div>
          </div>

          {/* Row 2: Stock Aging */}
          <div className="rounded-xl border border-border/60 p-5 shadow-card">
            <SectionTitle icon={<Clock />}>อายุสต๊อค (Stock Aging)</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {dashboard.stockAging.map((bucket, i) => {
                const colors = ['border-l-success', 'border-l-warning', 'border-l-warning', 'border-l-destructive'];
                return (
                  <div key={bucket.label} className={`bg-muted rounded-xl p-4 border-l-4 ${colors[i]}`}>
                    <div className="text-sm font-medium text-foreground">{bucket.label}</div>
                    <div className="text-2xl font-bold text-foreground mt-1">{bucket.count} <span className="text-sm font-normal text-muted-foreground">ชิ้น</span></div>
                    <div className="text-xs text-muted-foreground mt-1">{bucket.value.toLocaleString()} ฿</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Row 3: Value by Status + Stock Movement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5">
            {/* Value by Status — stacked bar + list */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<PieChartIcon />}>มูลค่าสต๊อคตามสถานะ</SectionTitle>
              {(() => {
                const total = dashboard.valueByStatus.reduce((s, i) => s + i.value, 0);
                if (total === 0) {
                  return (
                    <div className="text-sm text-muted-foreground text-center py-6">ยังไม่มีข้อมูลสต๊อค</div>
                  );
                }
                return (
                  <>
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted mb-4">
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
                    <div className="space-y-2">
                      {dashboard.valueByStatus.map((item) => {
                        const s = statusLabels[item.status] || { label: item.status, className: 'bg-muted text-foreground' };
                        const pct = total > 0 ? (item.value / total) * 100 : 0;
                        return (
                          <div
                            key={item.status}
                            className="flex items-center justify-between py-2 border-b border-border last:border-0"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
                              <span className="text-sm text-muted-foreground">{item.count} ชิ้น</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
                              <span className="text-sm font-medium text-foreground tabular-nums">
                                {item.value.toLocaleString()} ฿
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between pt-2 border-t border-border font-medium">
                        <span className="text-sm text-foreground">รวมทั้งหมด</span>
                        <span className="text-sm text-foreground tabular-nums">{total.toLocaleString()} ฿</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Stock Movement — recharts grouped bar */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<BarChart3 />}>การเคลื่อนไหวสต๊อค (6 เดือน)</SectionTitle>
              {(() => {
                // Trim leading zero-months so charts with only recent data don't look broken.
                const firstNonZero = dashboard.stockMovement.findIndex((m) => m.in > 0 || m.out > 0);
                const data =
                  firstNonZero === -1 ? [] : dashboard.stockMovement.slice(firstNonZero);

                if (data.length === 0) {
                  return (
                    <div className="text-sm text-muted-foreground text-center py-10">
                      ยังไม่มีการเคลื่อนไหวของสต๊อค
                    </div>
                  );
                }
                return (
                  <div className="h-64 -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border"
                          vertical={false}
                        />
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

          {/* Row 4: Category + Brand + Color + Storage Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-7.5">
            {/* By Category */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<Package />}>ตามประเภท</SectionTitle>
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
                {dashboard.byCategory.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">-</div>}
              </div>
            </div>

            {/* By Brand */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<Tag />}>ตามแบรนด์</SectionTitle>
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
                {dashboard.byBrand.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">-</div>}
              </div>
            </div>

            {/* By Color */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<Palette />}>ตามสี</SectionTitle>
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
                {dashboard.byColor.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">-</div>}
              </div>
            </div>

            {/* By Storage */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<HardDrive />}>ตามความจุ</SectionTitle>
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
                {dashboard.byStorage.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">-</div>}
              </div>
            </div>
          </div>

          {/* Row 5: Margin Overview -- Owner/Manager only */}
          {isManager && (
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<Wallet />}>กำไรเฉลี่ย (Margin Overview) - สินค้าพร้อมขาย</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="มูลค่าทุนรวม"
                  value={`${dashboard.marginOverview.totalCost.toLocaleString()} ฿`}
                  accent="border-l-muted-foreground"
                />
                <StatCard
                  label="มูลค่าขายรวม"
                  value={`${dashboard.marginOverview.totalSell.toLocaleString()} ฿`}
                  accent="border-l-primary"
                />
                <StatCard
                  label="กำไรรวม (ถ้าขายหมด)"
                  value={`${dashboard.marginOverview.totalMargin.toLocaleString()} ฿`}
                  sub={`Margin ${dashboard.marginOverview.avgMarginPct}%`}
                  accent="border-l-success"
                />
                <StatCard
                  label="กำไรเฉลี่ย/ชิ้น"
                  value={`${dashboard.marginOverview.avgMarginPerUnit.toLocaleString()} ฿`}
                  sub={`จาก ${dashboard.marginOverview.itemsWithPrice} ชิ้นที่มีราคาขาย`}
                  accent="border-l-primary"
                />
              </div>
            </div>
          )}

          {/* Row 7: Top Sellers + Slow Movers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5">
            {/* Top Sellers */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<Trophy />}>สินค้าขายดี (6 เดือนล่าสุด)</SectionTitle>
              {dashboard.topSellers.length > 0 ? (
                <div className="space-y-2">
                  {dashboard.topSellers.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? 'bg-warning/10 text-warning dark:bg-warning/15' :
                        i === 1 ? 'bg-muted text-muted-foreground' :
                        i === 2 ? 'bg-warning/10 text-warning dark:bg-warning/15' :
                        'bg-muted text-muted-foreground'
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
                      </div>
                      <span className="text-sm font-bold text-primary">{item.count} ชิ้น</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">ยังไม่มีข้อมูลการขาย</div>
              )}
            </div>

            {/* Slow Movers */}
            <div className="rounded-xl border border-border/60 p-5 shadow-card">
              <SectionTitle icon={<AlertTriangle />}>สินค้าค้างสต๊อคนานสุด</SectionTitle>
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
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            item.days > 90
                              ? 'bg-destructive/10 text-destructive dark:bg-destructive/15'
                              : 'bg-warning/10 text-warning dark:bg-warning/15'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
                          {isManager && (
                            <div className="text-xs text-muted-foreground">
                              {(Number(item.costPrice) || 0).toLocaleString()} ฿
                            </div>
                          )}
                        </div>
                        <span
                          className={`text-sm font-bold ${
                            item.days > 90 ? 'text-destructive' : 'text-warning'
                          }`}
                        >
                          {item.days} วัน
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {!dashboard && (
        <div className="rounded-xl border border-border/60 p-8 text-center text-muted-foreground">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
          กำลังโหลด Dashboard...
        </div>
      )}
    </>
  );
}

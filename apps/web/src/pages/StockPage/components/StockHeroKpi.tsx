import { Package, Wallet, Clock, TrendingUp, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import AnimatedCounter from '@/components/ui/animated-counter';
import { StockDashboard } from '../types';

export interface StockHeroKpiProps {
  totalInStock: number;
  totalValue: number;
  dashboard: StockDashboard | undefined;
  isManager: boolean;
}

function MoMTone({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    return <span className="text-[11px] text-muted-foreground/80">เริ่มเก็บข้อมูลเดือนนี้</span>;
  }
  const delta = ((current - previous) / previous) * 100;
  const up = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${
        up ? 'text-success' : 'text-destructive'
      }`}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {up ? '+' : ''}
      {delta.toFixed(0)}% MoM
    </span>
  );
}

export function StockHeroKpi({ totalInStock, totalValue, dashboard, isManager }: StockHeroKpiProps) {
  const avgDays = dashboard?.stockTurnover.avgDaysInStock;
  const marginPct = dashboard?.marginOverview.avgMarginPct;
  const soldThisMonth = dashboard?.stockTurnover.soldThisMonth ?? 0;
  const soldLastMonth = dashboard?.stockTurnover.soldLastMonth ?? 0;
  const totalCost = dashboard?.marginOverview.totalCost ?? 0;
  const totalSell = dashboard?.marginOverview.totalSell ?? 0;
  const avgDaysAlarm = avgDays != null && avgDays > 90;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {/* 1. พร้อมขาย — count + value */}
      <div className="rounded-xl border border-border/60 bg-card p-4 relative overflow-hidden">
        <div className="absolute -right-4 -top-4 size-20 rounded-full bg-primary/5" aria-hidden />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              พร้อมขาย
            </span>
            <Package className="size-4 text-primary" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tabular-nums">
              <AnimatedCounter value={totalInStock} />
            </span>
            <span className="text-xs text-muted-foreground">ชิ้น</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 tabular-nums">
            {totalValue.toLocaleString()} ฿
          </div>
        </div>
      </div>

      {/* 2. ขายเดือนนี้ + MoM */}
      <div className="rounded-xl border border-border/60 bg-card p-4 relative overflow-hidden">
        <div className="absolute -right-4 -top-4 size-20 rounded-full bg-success/5" aria-hidden />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              ขายเดือนนี้
            </span>
            <TrendingUp className="size-4 text-success" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tabular-nums">
              <AnimatedCounter value={soldThisMonth} />
            </span>
            <span className="text-xs text-muted-foreground">ชิ้น</span>
          </div>
          <div className="mt-1">
            <MoMTone current={soldThisMonth} previous={soldLastMonth} />
          </div>
        </div>
      </div>

      {/* 3. อายุเฉลี่ย (alert if > 90) */}
      <div
        className={`rounded-xl border p-4 relative overflow-hidden ${
          avgDaysAlarm
            ? 'border-warning/50 bg-warning/5'
            : 'border-border/60 bg-card'
        }`}
      >
        <div
          className={`absolute -right-4 -top-4 size-20 rounded-full ${
            avgDaysAlarm ? 'bg-warning/15' : 'bg-warning/5'
          }`}
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              อายุเฉลี่ย
            </span>
            <Clock className={`size-4 ${avgDaysAlarm ? 'text-warning' : 'text-muted-foreground'}`} />
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-3xl font-bold tabular-nums ${avgDaysAlarm ? 'text-warning' : ''}`}>
              {avgDays != null ? <AnimatedCounter value={avgDays} /> : '—'}
            </span>
            <span className="text-xs text-muted-foreground">วัน</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {avgDaysAlarm ? 'ต้องเร่งระบาย' : 'หมุนเวียนได้ดี'}
          </div>
        </div>
      </div>

      {/* 4. Margin (manager only) */}
      {isManager && (
        <div className="rounded-xl border border-border/60 bg-card p-4 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 size-20 rounded-full bg-primary/5" aria-hidden />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                margin เฉลี่ย
              </span>
              <Wallet className="size-4 text-primary" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold tabular-nums">
                {marginPct != null ? marginPct : '—'}
              </span>
              <span className="text-xs text-muted-foreground">%</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">
              ทุน {totalCost.toLocaleString()} → {totalSell.toLocaleString()} ฿
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

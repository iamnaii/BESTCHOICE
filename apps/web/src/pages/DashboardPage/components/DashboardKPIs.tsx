import { useNavigate } from 'react-router';
import { Card, CardContent } from '@/components/ui/card';
import {
  FileCheck,
  AlertTriangle,
  TrendingUp,
  Warehouse,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AnimatedCounter from '@/components/ui/animated-counter';
import type { KPIs, ComparativePL } from '../types';

interface DashboardKPIsProps {
  kpis: KPIs;
  comparativePL?: ComparativePL;
}

/**
 * MoM comparison indicator.
 * Shows percentage change vs previous month when `value` is provided.
 * TODO: Wire to real API data when /dashboard/kpis returns `previousMonth` fields.
 */
function MoMIndicator({ value }: { value?: number | null }) {
  if (value == null) return null;
  const isPositive = value >= 0;
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 text-2xs font-medium mt-1',
        isPositive ? 'text-success' : 'text-destructive',
      )}
    >
      <Icon className="size-3" />
      <span>{isPositive ? '+' : ''}{value.toFixed(1)}% จากเดือนก่อน</span>
    </div>
  );
}

export default function DashboardKPIs({ kpis, comparativePL }: DashboardKPIsProps) {
  const navigate = useNavigate();

  // MoM data from /reports/comparative-pl
  const revenueMoM = comparativePL?.momChange.revenue ?? null;
  const netProfitMoM = comparativePL?.momChange.netProfit ?? null;

  // KPI-level MoM fallback (if kpis API returns them in future)
  const kpisAny = kpis as unknown as Record<string, unknown>;
  const contractsMoM = (kpisAny.contractsMoM as number | undefined) ?? null;
  const overdueMoM = (kpisAny.overdueMoM as number | undefined) ?? null;
  const paymentsMoM = revenueMoM;  // revenue MoM is the best proxy for payments
  const stockMoM = (kpisAny.stockMoM as number | undefined) ?? null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
      {/* KPI: สัญญาทั้งหมด */}
      <Card
        className="cursor-pointer group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
        onClick={() => navigate('/contracts')}
      >
        <CardContent className="p-5 relative">
          <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-xl" />
          <div className="pl-2">
            <div className="flex items-center justify-between mb-4">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <FileCheck className="size-5 text-primary" />
              </div>
              <span className="text-2xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                ใช้งาน {kpis.contracts.active}
              </span>
            </div>
            <AnimatedCounter value={kpis.contracts.total} className="text-2xl lg:text-3xl font-bold text-foreground" />
            <div className="text-xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">สัญญาทั้งหมด</div>
            <MoMIndicator value={contractsMoM} />
          </div>
        </CardContent>
      </Card>

      {/* KPI: ค้าง/ผิดนัด */}
      <Card
        className="cursor-pointer group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
        onClick={() => navigate('/overdue')}
      >
        <CardContent className="p-5 relative">
          <div className="absolute inset-y-0 left-0 w-1 bg-destructive rounded-l-xl" />
          <div className="pl-2">
            <div className="flex items-center justify-between mb-4">
              <div className="size-10 rounded-xl bg-destructive/10 flex items-center justify-center group-hover:bg-destructive/20 transition-colors">
                <AlertTriangle className="size-5 text-destructive" />
              </div>
              <span className="text-2xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                {(kpis.overdueRate ?? 0).toFixed(1)}%
              </span>
            </div>
            <AnimatedCounter value={(kpis.contracts.overdue ?? 0) + (kpis.contracts.default ?? 0)} className="text-2xl lg:text-3xl font-bold text-foreground" />
            <div className="text-xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">ค้าง/ผิดนัด</div>
            <MoMIndicator value={overdueMoM} />
          </div>
        </CardContent>
      </Card>

      {/* KPI: ยอดรับวันนี้ */}
      <Card
        className="cursor-pointer group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
        onClick={() => navigate('/payments')}
      >
        <CardContent className="p-5 relative">
          <div className="absolute inset-y-0 left-0 w-1 bg-success rounded-l-xl" />
          <div className="pl-2">
            <div className="flex items-center justify-between mb-4">
              <div className="size-10 rounded-xl bg-success/10 flex items-center justify-center group-hover:bg-success/20 transition-colors">
                <TrendingUp className="size-5 text-success" />
              </div>
              <span className="text-2xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                <AnimatedCounter value={kpis.financial.todayPaymentCount} /> รายการ
              </span>
            </div>
            <AnimatedCounter value={kpis.financial.todayPayments} prefix="฿" className="text-2xl lg:text-3xl font-bold text-foreground" />
            <div className="text-xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">ยอดรับวันนี้</div>
            <MoMIndicator value={paymentsMoM} />
            {comparativePL?.yoyChange.revenue != null && (
              <div className="flex items-center gap-0.5 text-2xs font-medium mt-0.5 text-muted-foreground">
                <span>{comparativePL.yoyChange.revenue >= 0 ? '↑' : '↓'}{Math.abs(comparativePL.yoyChange.revenue).toFixed(1)}% vs ปีก่อน</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* KPI: สินค้าในสต็อก */}
      <Card
        className="cursor-pointer group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
        onClick={() => navigate('/stock')}
      >
        <CardContent className="p-5 relative">
          <div className="absolute inset-y-0 left-0 w-1 bg-warning rounded-l-xl" />
          <div className="pl-2">
            <div className="flex items-center justify-between mb-4">
              <div className="size-10 rounded-xl bg-warning/10 flex items-center justify-center group-hover:bg-warning/20 transition-colors">
                <Warehouse className="size-5 text-warning" />
              </div>
              <span className="text-2xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                รวม <AnimatedCounter value={kpis.products.total} />
              </span>
            </div>
            <AnimatedCounter value={kpis.products.inStock} className="text-2xl lg:text-3xl font-bold text-foreground" />
            <div className="text-xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">สินค้าในสต็อก</div>
            <MoMIndicator value={stockMoM} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Package, Wallet, Clock, TrendingUp } from 'lucide-react';
import AnimatedCounter from '@/components/ui/animated-counter';
import { StockDashboard } from '../types';

export interface StockHeroKpiProps {
  totalInStock: number;
  totalValue: number;
  dashboard: StockDashboard | undefined;
  isManager: boolean;
}

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent: string;
}

function Kpi({ icon, label, value, hint, accent }: KpiProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 flex items-start gap-3 shadow-card">
      <div className={`size-10 shrink-0 rounded-xl flex items-center justify-center ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </div>
        <div className="text-xl font-bold text-foreground mt-0.5 truncate">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5 truncate">{hint}</div>}
      </div>
    </div>
  );
}

export function StockHeroKpi({ totalInStock, totalValue, dashboard, isManager }: StockHeroKpiProps) {
  const avgDays = dashboard?.stockTurnover.avgDaysInStock;
  const marginPct = dashboard?.marginOverview.avgMarginPct;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Kpi
        icon={<Package className="size-5 text-primary" />}
        label="พร้อมขาย"
        value={<AnimatedCounter value={totalInStock} />}
        hint="ชิ้น"
        accent="bg-primary/10"
      />
      <Kpi
        icon={<Wallet className="size-5 text-success" />}
        label="มูลค่าพร้อมขาย"
        value={`${totalValue.toLocaleString()} ฿`}
        accent="bg-success/10"
      />
      <Kpi
        icon={<Clock className="size-5 text-warning" />}
        label="อายุเฉลี่ยในสต๊อค"
        value={avgDays != null ? `${avgDays} วัน` : '-'}
        accent="bg-warning/10"
      />
      {isManager && (
        <Kpi
          icon={<TrendingUp className="size-5 text-primary" />}
          label="Margin เฉลี่ย"
          value={marginPct != null ? `${marginPct}%` : '-'}
          hint="สินค้าพร้อมขายที่ตั้งราคาแล้ว"
          accent="bg-primary/10"
        />
      )}
    </div>
  );
}

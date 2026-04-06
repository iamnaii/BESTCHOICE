import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import {
  FileCheck,
  AlertTriangle,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import AnimatedCounter from '@/components/ui/animated-counter';
import type { KPIs } from '../types';

interface DashboardKPIsProps {
  kpis: KPIs;
}

export default function DashboardKPIs({ kpis }: DashboardKPIsProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
      <Card className="cursor-pointer group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 border-l-[3px] border-l-primary" onClick={() => navigate('/contracts')}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <FileCheck className="size-5 text-primary" />
            </div>
          </div>
          <AnimatedCounter value={kpis.contracts.total} className="text-2xl lg:text-3xl font-bold text-foreground" />
          <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">สัญญาทั้งหมด</div>
          <div className="text-xs text-muted-foreground mt-1">ปกติ <AnimatedCounter value={kpis.contracts.active} className="text-success font-semibold" /></div>
        </CardContent>
      </Card>
      <Card className="cursor-pointer group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 border-l-[3px] border-l-destructive" onClick={() => navigate('/overdue')}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="size-10 rounded-xl bg-destructive/10 flex items-center justify-center group-hover:bg-destructive/15 transition-colors">
              <AlertTriangle className="size-5 text-destructive" />
            </div>
            <span className="text-2xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-md">{(kpis.overdueRate ?? 0).toFixed(1)}%</span>
          </div>
          <AnimatedCounter value={(kpis.contracts.overdue ?? 0) + (kpis.contracts.default ?? 0)} className="text-2xl lg:text-3xl font-bold text-foreground" />
          <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">ค้าง/ผิดนัด</div>
        </CardContent>
      </Card>
      <Card className="cursor-pointer group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 border-l-[3px] border-l-success" onClick={() => navigate('/payments')}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="size-10 rounded-xl bg-success/10 flex items-center justify-center group-hover:bg-success/15 transition-colors">
              <TrendingUp className="size-5 text-success" />
            </div>
            <span className="text-2xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md"><AnimatedCounter value={kpis.financial.todayPaymentCount} /> รายการ</span>
          </div>
          <AnimatedCounter value={kpis.financial.todayPayments} prefix="฿" className="text-2xl lg:text-3xl font-bold text-foreground" />
          <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">ยอดรับวันนี้</div>
        </CardContent>
      </Card>
      <Card className="cursor-pointer group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 border-l-[3px] border-l-warning" onClick={() => navigate('/stock')}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="size-10 rounded-xl bg-warning/10 flex items-center justify-center group-hover:bg-warning/15 transition-colors">
              <Warehouse className="size-5 text-warning" />
            </div>
          </div>
          <AnimatedCounter value={kpis.products.inStock} className="text-2xl lg:text-3xl font-bold text-foreground" />
          <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">สินค้าในสต็อก</div>
          <div className="text-xs text-muted-foreground mt-1">จาก <AnimatedCounter value={kpis.products.total} className="font-semibold" /></div>
        </CardContent>
      </Card>
    </div>
  );
}

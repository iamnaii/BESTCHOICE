import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import ShopLayout from '../../components/layout/ShopLayout';
import PlanProgressBar from '../../components/saving-plan/PlanProgressBar';
import { Button } from '../../components/ui/button';
import type { SavingPlan, SavingPlanStatus } from '../../types/saving-plan';

const STATUS_LABEL: Record<SavingPlanStatus, string> = {
  ACTIVE: 'กำลังออม',
  COMPLETED: 'ออมครบแล้ว',
  APPLIED: 'นำไปใช้ดาวน์แล้ว',
  CANCELLED: 'ยกเลิก',
};

export default function SavingPlansPage() {
  const { data, isLoading } = useQuery<SavingPlan[]>({
    queryKey: ['saving-plans'],
    queryFn: () => api.get('/api/shop/saving-plans').then((r) => r.data as SavingPlan[]),
  });
  const plans = data ?? [];
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-4 leading-snug">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">แผนออมดาวน์ของฉัน</h1>
          <Link to="/saving-plan/create">
            <Button size="sm">+ สร้างแผน</Button>
          </Link>
        </div>
        {isLoading && <div className="text-muted-foreground text-sm">กำลังโหลด...</div>}
        {!isLoading && plans.length === 0 && (
          <div className="rounded-xl border border-border p-6 text-center space-y-3">
            <div className="text-muted-foreground">ยังไม่มีแผนออมดาวน์</div>
            <Link to="/saving-plan">
              <Button variant="outline">เริ่มออมดาวน์</Button>
            </Link>
          </div>
        )}
        {plans.map((p) => (
          <Link
            key={p.id}
            to={`/saving-plan/${p.id}`}
            className="block rounded-xl border border-border p-4 space-y-2 hover:border-primary transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{p.planNumber}</div>
                <div className="text-sm text-muted-foreground">
                  {p.targetProductModel ?? 'ไม่ระบุรุ่น'}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{STATUS_LABEL[p.status]}</div>
            </div>
            <PlanProgressBar
              total={Number(p.totalSaved)}
              target={Number(p.targetAmount)}
            />
          </Link>
        ))}
      </div>
    </ShopLayout>
  );
}

import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PiggyBank } from 'lucide-react';
import { api } from '@/lib/api';
import ShopLayout from '@/components/layout/ShopLayout';
import PlanProgressBar from '@/components/saving-plan/PlanProgressBar';
import {
  Badge,
  Card,
  CardBody,
  CategoryHero,
  Container,
  StatefulList,
} from '@/components';
import type { SavingPlan, SavingPlanStatus } from '@/types/saving-plan';

const STATUS_LABEL: Record<SavingPlanStatus, string> = {
  ACTIVE: 'กำลังออม',
  COMPLETED: 'ออมครบแล้ว',
  APPLIED: 'นำไปใช้ดาวน์แล้ว',
  CANCELLED: 'ยกเลิก',
};

const STATUS_VARIANT: Record<SavingPlanStatus, 'primary' | 'success' | 'outline' | 'default'> = {
  ACTIVE: 'primary',
  COMPLETED: 'success',
  APPLIED: 'default',
  CANCELLED: 'outline',
};

function formatDate(v: string | null | undefined) {
  if (!v) return null;
  try {
    return new Date(v).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

export default function SavingPlansPage() {
  const { data, isLoading, isError, refetch } = useQuery<SavingPlan[]>({
    queryKey: ['saving-plans'],
    queryFn: () => api.get('/api/shop/saving-plans').then((r) => r.data as SavingPlan[]),
  });

  return (
    <ShopLayout>
      <CategoryHero
        title="แผนออมดาวน์ของฉัน"
        breadcrumbs={[{ label: 'บัญชี', to: '/account' }, { label: 'ออมดาวน์' }]}
      />
      <Container>
        <div className="py-6 md:py-8 space-y-6 leading-snug">
          <StatefulList<SavingPlan>
            isLoading={isLoading}
            isError={isError}
            data={data}
            onRetry={() => refetch()}
            loadingVariant="list"
            emptyState={{
              icon: <PiggyBank />,
              title: 'ยังไม่มีแผนออมดาวน์',
              description: 'เริ่มสร้างแผนออมดาวน์เพื่อเครื่องที่คุณอยากได้',
              cta: { label: 'เริ่มออมดาวน์', to: '/saving-plan' },
            }}
            wrapperClassName="space-y-3"
            renderItem={(p) => {
              const nextDue = formatDate(p.nextPaymentDueAt);
              return (
                <Card key={p.id} variant="interactive">
                  <Link to={`/saving-plan/${p.id}`} className="block">
                    <CardBody className="space-y-3">
                      <div className="flex items-start justify-between gap-3 leading-snug">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-foreground">{p.planNumber}</div>
                          <div className="text-sm text-muted-foreground">
                            {p.targetProductModel ?? 'ไม่ระบุรุ่น'}
                          </div>
                        </div>
                        <Badge variant={STATUS_VARIANT[p.status]} size="sm">
                          {STATUS_LABEL[p.status]}
                        </Badge>
                      </div>

                      <PlanProgressBar
                        total={Number(p.totalSaved)}
                        target={Number(p.targetAmount)}
                      />

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground leading-snug">
                        <span>
                          งวดละ ฿{Number(p.monthlyAmount).toLocaleString()} ·{' '}
                          {p.durationMonths} เดือน
                        </span>
                        {nextDue && p.status === 'ACTIVE' && <span>ครบกำหนด {nextDue}</span>}
                      </div>
                    </CardBody>
                  </Link>
                </Card>
              );
            }}
          />
        </div>
      </Container>
    </ShopLayout>
  );
}

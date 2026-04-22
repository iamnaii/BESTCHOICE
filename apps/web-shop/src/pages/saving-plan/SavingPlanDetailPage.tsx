import { useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { PiggyBank } from 'lucide-react';
import { api } from '@/lib/api';
import ShopLayout from '@/components/layout/ShopLayout';
import PlanProgressBar from '@/components/saving-plan/PlanProgressBar';
import PaymentHistoryTable from '@/components/saving-plan/PaymentHistoryTable';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  Section,
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

export default function SavingPlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useQuery<SavingPlan>({
    queryKey: ['saving-plan', id],
    queryFn: () => api.get(`/api/shop/saving-plans/${id}`).then((r) => r.data as SavingPlan),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const pay = useMutation({
    mutationFn: () =>
      api
        .post(`/api/shop/saving-plans/${id}/pay`, { amount: Number(data?.monthlyAmount) })
        .then((r) => r.data as { paymentLinkId: string; paymentUrl: string }),
    onSuccess: (res) => {
      if (res.paymentUrl) window.location.href = res.paymentUrl;
      else toast.success('เปิดใบชำระแล้ว');
    },
    onError: (e: AxiosError<{ message?: string }>) =>
      toast.error(e.response?.data?.message ?? 'สร้างใบชำระไม่สำเร็จ'),
  });

  const listData = data ? [data] : undefined;

  return (
    <ShopLayout>
      <CategoryHero
        title={data?.planNumber ?? 'แผนออมดาวน์'}
        breadcrumbs={[
          { label: 'บัญชี', to: '/account' },
          { label: 'ออมดาวน์', to: '/account/saving-plans' },
          { label: data?.planNumber ?? 'แผนออมดาวน์' },
        ]}
      />
      <Container>
        <div className="py-6 md:py-8 leading-snug">
          <StatefulList<SavingPlan>
            isLoading={isLoading}
            isError={isError}
            data={listData}
            onRetry={() => refetch()}
            loadingVariant="detail"
            emptyState={{
              icon: <PiggyBank />,
              title: 'ไม่พบแผนออมดาวน์',
              description: 'แผนนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง',
            }}
            renderItem={(plan) => (
              <div key={plan.id} className="grid gap-4 md:grid-cols-2">
                <Card variant="elevated">
                  <CardBody className="space-y-4">
                    <div className="flex items-start justify-between gap-3 leading-snug">
                      <div>
                        <div className="text-sm text-muted-foreground">
                          {plan.targetProductModel ?? 'ไม่ระบุรุ่น'}
                        </div>
                        <div className="text-lg font-semibold text-foreground">
                          {plan.planNumber}
                        </div>
                      </div>
                      <Badge variant={STATUS_VARIANT[plan.status]} size="md">
                        {STATUS_LABEL[plan.status]}
                      </Badge>
                    </div>

                    <PlanProgressBar
                      total={Number(plan.totalSaved)}
                      target={Number(plan.targetAmount)}
                    />

                    <div className="space-y-2 border-t border-zinc-200 pt-3">
                      <div className="flex items-center justify-between text-sm leading-snug">
                        <span className="text-muted-foreground">เป้าหมาย</span>
                        <span className="font-semibold text-foreground">
                          ฿{Number(plan.targetAmount).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm leading-snug">
                        <span className="text-muted-foreground">สะสม</span>
                        <span className="font-semibold text-emerald-600">
                          ฿{Number(plan.totalSaved).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm leading-snug">
                        <span className="text-muted-foreground">งวดละ</span>
                        <span className="text-foreground">
                          ฿{Number(plan.monthlyAmount).toLocaleString()} × {plan.durationMonths}{' '}
                          เดือน
                        </span>
                      </div>
                    </div>
                  </CardBody>
                </Card>

                <Card variant="outlined">
                  <CardBody className="flex flex-col gap-3">
                    <div className="space-y-1 leading-snug">
                      <div className="text-sm text-muted-foreground">ยอดที่ต้องชำระงวดนี้</div>
                      <div className="text-3xl font-bold text-emerald-600">
                        ฿{Number(plan.monthlyAmount).toLocaleString()}
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      size="lg"
                      fullWidth
                      onClick={() => pay.mutate()}
                      disabled={plan.status !== 'ACTIVE' || pay.isPending}
                      loading={pay.isPending}
                    >
                      {pay.isPending ? 'กำลังสร้างใบชำระ...' : 'ชำระงวดนี้'}
                    </Button>
                    {plan.status !== 'ACTIVE' && (
                      <p className="text-xs text-muted-foreground leading-snug">
                        แผนนี้ไม่สามารถชำระเพิ่มได้ในสถานะปัจจุบัน
                      </p>
                    )}
                  </CardBody>
                </Card>
              </div>
            )}
          />
        </div>
      </Container>

      {data && (
        <Section tone="muted" padding="sm">
          <Container>
            <h2 className="text-xl font-bold leading-snug mb-4">ประวัติการชำระ</h2>
            <PaymentHistoryTable payments={data.payments ?? []} />
          </Container>
        </Section>
      )}
    </ShopLayout>
  );
}

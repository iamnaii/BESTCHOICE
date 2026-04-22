import { useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { api } from '../../lib/api';
import ShopLayout from '../../components/layout/ShopLayout';
import PlanProgressBar from '../../components/saving-plan/PlanProgressBar';
import PaymentHistoryTable from '../../components/saving-plan/PaymentHistoryTable';
import { Button } from '../../components/ui/button';
import type { SavingPlan, SavingPlanStatus } from '../../types/saving-plan';

const STATUS_LABEL: Record<SavingPlanStatus, string> = {
  ACTIVE: 'กำลังออม',
  COMPLETED: 'ออมครบแล้ว',
  APPLIED: 'นำไปใช้ดาวน์แล้ว',
  CANCELLED: 'ยกเลิก',
};

export default function SavingPlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery<SavingPlan>({
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
  if (!data) {
    return (
      <ShopLayout>
        <div className="p-8 text-muted-foreground leading-snug">กำลังโหลด...</div>
      </ShopLayout>
    );
  }
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-4 leading-snug">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{data.planNumber}</h1>
          <div className="text-sm text-muted-foreground">
            {data.targetProductModel ?? 'ไม่ระบุรุ่น'} · {STATUS_LABEL[data.status]}
          </div>
        </div>
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex justify-between">
            <span>เป้าหมาย</span>
            <span className="font-semibold">
              ฿{Number(data.targetAmount).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span>สะสม</span>
            <span className="font-semibold">
              ฿{Number(data.totalSaved).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>งวดละ</span>
            <span>
              ฿{Number(data.monthlyAmount).toLocaleString()} × {data.durationMonths} เดือน
            </span>
          </div>
          <PlanProgressBar
            total={Number(data.totalSaved)}
            target={Number(data.targetAmount)}
          />
        </div>
        {data.status === 'ACTIVE' && (
          <Button className="w-full" onClick={() => pay.mutate()} disabled={pay.isPending}>
            {pay.isPending
              ? 'กำลังสร้างใบชำระ...'
              : `ชำระงวดนี้ ฿${Number(data.monthlyAmount).toLocaleString()}`}
          </Button>
        )}
        <PaymentHistoryTable payments={data.payments ?? []} />
      </div>
    </ShopLayout>
  );
}

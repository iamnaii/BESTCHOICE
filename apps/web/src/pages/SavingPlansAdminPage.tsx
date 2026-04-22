import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PiggyBank } from 'lucide-react';
import api from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { formatDateShort } from '@/utils/formatters';

type SavingPlanStatus = 'ACTIVE' | 'COMPLETED' | 'APPLIED' | 'CANCELLED';

interface SavingPlan {
  id: string;
  planNumber: string;
  customerId: string;
  customer?: { id: string; name: string; phone?: string | null } | null;
  targetProductModel?: string | null;
  targetProduct?: { id: string; name: string } | null;
  targetAmount: string | number;
  monthlyAmount: string | number;
  durationMonths: number;
  totalSaved: string | number;
  status: SavingPlanStatus;
  nextPaymentDueAt?: string | null;
  startedAt: string;
}

interface SavingPlansResponse {
  data: SavingPlan[];
  total?: number;
}

const STATUS_TABS: Array<{ key: SavingPlanStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'ACTIVE', label: 'กำลังออม' },
  { key: 'COMPLETED', label: 'ออมครบแล้ว' },
  { key: 'APPLIED', label: 'ใช้กับสัญญาแล้ว' },
  { key: 'CANCELLED', label: 'ยกเลิก' },
];

const STATUS_BADGE: Record<SavingPlanStatus, { label: string; variant: 'primary' | 'success' | 'secondary' | 'destructive' | 'info' }> = {
  ACTIVE: { label: 'กำลังออม', variant: 'info' },
  COMPLETED: { label: 'ออมครบแล้ว', variant: 'success' },
  APPLIED: { label: 'ใช้กับสัญญาแล้ว', variant: 'primary' },
  CANCELLED: { label: 'ยกเลิก', variant: 'destructive' },
};

function formatMoney(v: string | number | undefined | null): string {
  if (v === null || v === undefined) return '-';
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcProgress(saved: string | number, target: string | number): number {
  const s = typeof saved === 'string' ? Number(saved) : saved;
  const t = typeof target === 'string' ? Number(target) : target;
  if (!t || Number.isNaN(s) || Number.isNaN(t)) return 0;
  return Math.min(100, Math.round((s / t) * 100));
}

export default function SavingPlansAdminPage() {
  useDocumentTitle('แผนออมเพื่อซื้อมือถือ');
  const [statusFilter, setStatusFilter] = useState<SavingPlanStatus | 'ALL'>('ALL');

  const { data, isLoading, isError, error, refetch } = useQuery<SavingPlansResponse>({
    queryKey: ['admin-saving-plans', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const qs = params.toString();
      const res = await api.get(`/admin/saving-plans${qs ? `?${qs}` : ''}`);
      const body = res.data;
      if (Array.isArray(body)) return { data: body, total: body.length };
      return body;
    },
  });

  const plans = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="แผนออมเพื่อซื้อมือถือ"
        subtitle="ภาพรวมแผนออมของลูกค้า — อ่านอย่างเดียว (ลูกค้าจ่ายเงินผ่าน LINE OA)"
        icon={<PiggyBank className="size-5" />}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm leading-snug transition-colors ${
              statusFilter === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">เลขที่แผน</th>
                <th className="px-4 py-3 text-left font-medium">ลูกค้า</th>
                <th className="px-4 py-3 text-left font-medium">เป้าหมาย</th>
                <th className="px-4 py-3 text-right font-medium">สะสม / เป้าหมาย</th>
                <th className="px-4 py-3 text-left font-medium">งวดถัดไป</th>
                <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {plans.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    ไม่มีแผนออมในสถานะนี้
                  </td>
                </tr>
              ) : (
                plans.map((plan) => {
                  const badge = STATUS_BADGE[plan.status];
                  const progress = calcProgress(plan.totalSaved, plan.targetAmount);
                  return (
                    <tr key={plan.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3 font-medium text-foreground">{plan.planNumber}</td>
                      <td className="px-4 py-3 text-foreground">
                        <div className="leading-snug">{plan.customer?.name ?? '-'}</div>
                        {plan.customer?.phone && (
                          <div className="text-xs text-muted-foreground leading-snug">
                            {plan.customer.phone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground leading-snug">
                        {plan.targetProduct?.name ?? plan.targetProductModel ?? '-'}
                        <div className="text-xs text-muted-foreground">
                          {formatMoney(plan.monthlyAmount)} × {plan.durationMonths} งวด
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        <div>
                          {formatMoney(plan.totalSaved)} / {formatMoney(plan.targetAmount)}
                        </div>
                        <div className="mt-1 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{progress}%</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {plan.nextPaymentDueAt ? formatDateShort(plan.nextPaymentDueAt) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {badge ? (
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        ) : (
                          <Badge variant="secondary">{plan.status}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}

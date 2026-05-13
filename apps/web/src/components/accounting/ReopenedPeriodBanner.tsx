import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { accountingApi, type ReopenedPeriod } from '@/lib/accounting';

export function ReopenedPeriodBanner() {
  const { data } = useQuery<ReopenedPeriod[]>({
    queryKey: ['accounting-periods', 'reopened'],
    queryFn: () => accountingApi.listReopenedPeriods(),
    staleTime: 60_000,
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-2">
      {data.map((p) => {
        const periodLabel = `${p.year}-${String(p.month).padStart(2, '0')}`;
        return (
          <Alert key={p.id || periodLabel} variant="warning" className="border-warning bg-warning/10">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <AlertTitle>งวด {periodLabel} ถูกเปิดชั่วคราว</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>
                เปิดเมื่อ: {new Date(p.reopenedAt).toLocaleString('th-TH')}
                {p.reopenedBy?.name ? ` โดย ${p.reopenedBy.name}` : ''}
              </p>
              {p.reopenReason && <p>เหตุผล: {p.reopenReason}</p>}
              {p.taxFiled && <p className="text-destructive font-medium">ภ.พ.30 ยื่นแล้ว — ต้องยื่นแก้ไขด้วย</p>}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}

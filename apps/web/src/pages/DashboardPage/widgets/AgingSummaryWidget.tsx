import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import QueryBoundary from '@/components/QueryBoundary';
import api from '@/lib/api';
import { formatNumberDecimal } from '@/utils/formatters';

interface AgingBuckets {
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
}

interface AgingReport {
  asOf: string;
  summary: AgingBuckets;
}

const BUCKETS: { key: keyof AgingBuckets; label: string; color: string }[] = [
  { key: 'bucket_0_30', label: '0–30 วัน', color: 'text-warning' },
  { key: 'bucket_31_60', label: '31–60 วัน', color: 'text-orange-500' },
  { key: 'bucket_61_90', label: '61–90 วัน', color: 'text-destructive' },
  { key: 'bucket_90_plus', label: '90+ วัน', color: 'text-destructive font-bold' },
];

export default function AgingSummaryWidget() {
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery<AgingReport>({
    queryKey: ['dashboard-fin-aging-widget'],
    queryFn: async () => {
      const asOf = new Date().toISOString();
      const { data: res } = await api.get(`/expenses/ledger/aging?asOf=${encodeURIComponent(asOf)}`);
      return res;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 flex-row items-center gap-2">
        <div className="size-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
          <AlertTriangle className="size-4 text-destructive" />
        </div>
        <span className="font-semibold text-sm leading-snug">ลูกหนี้ค้างชำระ (Aging)</span>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between gap-3">
        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          errorTitle="โหลด Aging ไม่สำเร็จ"
        >
          {data ? (
            <div className="grid grid-cols-2 gap-2">
              {BUCKETS.map((bucket) => (
                <div
                  key={bucket.key}
                  className="bg-muted rounded-lg p-2.5 flex flex-col gap-0.5"
                >
                  <span className="text-2xs text-muted-foreground leading-snug">{bucket.label}</span>
                  <span className={`text-sm font-semibold leading-snug ${bucket.color}`}>
                    {formatNumberDecimal(data.summary[bucket.key], 0)} ฿
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </QueryBoundary>
        <Link
          to="/finance/aging-report"
          className="flex items-center gap-1 text-xs text-primary hover:underline mt-auto self-end"
        >
          ดูรายงานเต็ม <ArrowRight className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

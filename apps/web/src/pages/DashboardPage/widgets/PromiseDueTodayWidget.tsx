import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Bell } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import QueryBoundary from '@/components/QueryBoundary';
import api from '@/lib/api';
import { formatNumberDecimal } from '@/utils/formatters';

interface PromiseDueItem {
  promiseSlotId: string;
  contractId: string;
  contractNumber: string;
  customerId: string;
  customerName: string;
  phone: string;
  settlementAmount: number;
}

export default function PromiseDueTodayWidget() {
  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<PromiseDueItem[]>({
    queryKey: ['dashboard-fin-promises-due-today'],
    queryFn: async () => {
      const { data: res } = await api.get('/overdue/promises/due-today');
      return res;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 flex-row items-center gap-2">
        <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
          <Bell className="size-4 text-warning" />
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="font-semibold text-sm leading-snug">ติดตามหนี้วันนี้</span>
          {data.length > 0 && (
            <span className="text-2xs font-semibold bg-warning/15 text-warning px-1.5 py-0.5 rounded-full leading-snug shrink-0">
              {data.length}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          errorTitle="โหลดนัดหมายไม่สำเร็จ"
        >
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground leading-snug py-4 text-center">
              ไม่มีนัดวันนี้
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.slice(0, 8).map((item) => (
                <li key={item.promiseSlotId} className="py-2 first:pt-0">
                  <Link
                    to={`/contracts/${item.contractId}`}
                    className="flex items-start justify-between gap-2 group hover:bg-accent rounded px-1 -mx-1"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground leading-snug truncate group-hover:text-primary">
                        {item.customerName}
                      </p>
                      <p className="text-2xs text-muted-foreground leading-snug">
                        {item.contractNumber} · {item.phone || '—'}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-primary shrink-0 leading-snug">
                      {formatNumberDecimal(item.settlementAmount, 0)} ฿
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

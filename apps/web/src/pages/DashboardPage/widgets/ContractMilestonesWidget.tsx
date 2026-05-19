import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { FileCheck } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import QueryBoundary from '@/components/QueryBoundary';
import api from '@/lib/api';
import { formatNumberDecimal, formatDateMedium } from '@/utils/formatters';

interface FinalInstallment {
  paymentId: string;
  contractId: string;
  contractNumber: string;
  customerName: string;
  dueDate: string;
  amountDue: number;
  installmentNo: number;
  totalMonths: number;
}

interface MilestonesSummary {
  newThisMonth: { count: number; totalAmount: number };
  completingThisMonth: { count: number; totalAmount: number };
  recentNewContracts: {
    id: string;
    contractNumber: string;
    customerName: string;
    financedAmount: number;
    createdAt: string;
  }[];
  finalInstallmentsThisMonth: FinalInstallment[];
}

export default function ContractMilestonesWidget() {
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery<MilestonesSummary>({
    queryKey: ['dashboard-fin-contract-milestones'],
    queryFn: async () => {
      const { data: res } = await api.get('/contracts/milestones-summary');
      return res;
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 flex-row items-center gap-2">
        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileCheck className="size-4 text-primary" />
        </div>
        <span className="font-semibold text-sm leading-snug">สัญญาเดือนนี้</span>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          errorTitle="โหลดสัญญาไม่สำเร็จ"
        >
          {data ? (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-muted rounded-lg p-2.5 flex flex-col gap-0.5">
                  <span className="text-2xs text-muted-foreground leading-snug">สัญญาใหม่</span>
                  <span className="text-lg font-bold text-foreground leading-snug">
                    {data.newThisMonth.count}
                  </span>
                  <span className="text-2xs text-muted-foreground leading-snug">
                    {formatNumberDecimal(data.newThisMonth.totalAmount, 0)} ฿
                  </span>
                </div>
                <div className="bg-muted rounded-lg p-2.5 flex flex-col gap-0.5">
                  <span className="text-2xs text-muted-foreground leading-snug">งวดสุดท้าย</span>
                  <span className="text-lg font-bold text-success leading-snug">
                    {data.completingThisMonth.count}
                  </span>
                  <span className="text-2xs text-muted-foreground leading-snug">
                    {formatNumberDecimal(data.completingThisMonth.totalAmount, 0)} ฿
                  </span>
                </div>
              </div>

              {/* Final installments this month */}
              {data.finalInstallmentsThisMonth.length > 0 && (
                <div>
                  <p className="text-2xs text-muted-foreground uppercase tracking-wider mb-1.5 leading-snug">
                    งวดสุดท้ายเดือนนี้
                  </p>
                  <ul className="divide-y divide-border">
                    {data.finalInstallmentsThisMonth.map((item) => (
                      <li key={item.paymentId} className="py-1.5 first:pt-0">
                        <Link
                          to={`/contracts/${item.contractId}`}
                          className="flex items-start justify-between gap-2 group hover:bg-accent rounded px-1 -mx-1"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground leading-snug truncate group-hover:text-primary">
                              {item.customerName}
                            </p>
                            <p className="text-2xs text-muted-foreground leading-snug">
                              {item.contractNumber} · งวด {item.installmentNo}/{item.totalMonths}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-semibold text-primary leading-snug">
                              {formatNumberDecimal(item.amountDue, 0)} ฿
                            </p>
                            <p className="text-2xs text-muted-foreground leading-snug">
                              {formatDateMedium(item.dueDate)}
                            </p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Landmark, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import QueryBoundary from '@/components/QueryBoundary';
import api from '@/lib/api';
import { bankAccountsApi, type BankAccount } from '@/lib/api/bank-accounts';
import { formatNumberDecimal } from '@/utils/formatters';

interface ForecastBucket {
  count: number;
  amount: number;
}

interface CashForecast {
  asOf: string;
  overdue: ForecastBucket;
  next7Days: ForecastBucket;
  next30Days: ForecastBucket;
}

function sumBalances(accounts: BankAccount[]): number {
  return accounts.reduce((sum, a) => sum + parseFloat(a.balance || '0'), 0);
}

export default function CashPositionWidget() {
  const accountsQuery = useQuery({
    queryKey: ['bank-accounts', true],
    queryFn: () => bankAccountsApi.list(true),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const forecastQuery = useQuery<CashForecast>({
    queryKey: ['dashboard-cash-forecast'],
    queryFn: async () => (await api.get('/dashboard/cash-forecast')).data,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const accounts = accountsQuery.data ?? [];
  const total = sumBalances(accounts);
  const topAccounts = [...accounts]
    .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance))
    .slice(0, 3);

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 flex-row items-center gap-2">
        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Landmark className="size-4 text-primary" />
        </div>
        <span className="font-semibold text-sm leading-snug">เงินสด/ธนาคาร</span>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between gap-3">
        <QueryBoundary
          isLoading={accountsQuery.isLoading}
          isError={accountsQuery.isError}
          onRetry={accountsQuery.refetch}
          errorTitle="โหลดยอดเงินสดไม่สำเร็จ"
        >
          <div className="space-y-2">
            <div>
              <p className="text-2xs text-muted-foreground leading-snug">ยอดรวมทุกบัญชี</p>
              <p
                className={`text-xl font-semibold leading-snug ${total < 0 ? 'text-destructive' : ''}`}
              >
                {formatNumberDecimal(total, 2)} ฿
              </p>
            </div>
            {topAccounts.length > 0 && (
              <div className="space-y-1">
                {topAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between gap-2 text-xs leading-snug"
                  >
                    <span className="text-muted-foreground truncate">{acc.accountName}</span>
                    <span
                      className={`font-medium shrink-0 ${parseFloat(acc.balance) < 0 ? 'text-destructive' : ''}`}
                    >
                      {formatNumberDecimal(parseFloat(acc.balance), 0)} ฿
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </QueryBoundary>

        <QueryBoundary
          isLoading={forecastQuery.isLoading}
          isError={forecastQuery.isError}
          onRetry={forecastQuery.refetch}
          errorTitle="โหลดเงินคาดว่าจะเข้าไม่สำเร็จ"
        >
          {forecastQuery.data ? (
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-muted rounded-lg p-2 flex flex-col gap-0.5">
                <span className="text-2xs text-muted-foreground leading-snug">เข้า 7 วัน</span>
                <span className="text-xs font-semibold leading-snug text-success">
                  {formatNumberDecimal(forecastQuery.data.next7Days.amount, 0)} ฿
                </span>
              </div>
              <div className="bg-muted rounded-lg p-2 flex flex-col gap-0.5">
                <span className="text-2xs text-muted-foreground leading-snug">รวม 30 วัน</span>
                <span className="text-xs font-semibold leading-snug text-success">
                  {formatNumberDecimal(forecastQuery.data.next30Days.amount, 0)} ฿
                </span>
              </div>
              <div className="bg-muted rounded-lg p-2 flex flex-col gap-0.5">
                <span className="text-2xs text-muted-foreground leading-snug">ค้างเกินกำหนด</span>
                <span className="text-xs font-semibold leading-snug text-destructive">
                  {formatNumberDecimal(forecastQuery.data.overdue.amount, 0)} ฿
                </span>
              </div>
            </div>
          ) : null}
        </QueryBoundary>

        <Link
          to="/finance/bank-accounts"
          className="flex items-center gap-1 text-xs text-primary hover:underline mt-auto self-end"
        >
          ดูบัญชีทั้งหมด <ArrowRight className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

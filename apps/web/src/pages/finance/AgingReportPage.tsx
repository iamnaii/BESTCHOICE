import { OVERDUE_BUCKETS } from '@/lib/aging-presentation';
import { toBangkokDateString } from '@/lib/date';
import { useId as useUiFieldId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useUiFlags } from '@/hooks/useUiFlags';
import { formatDateMedium } from '@/utils/formatters';

interface AgingCustomer {
  customerId: string;
  customerName: string;
  phone: string;
  totalOverdue: number;
  daysOverdue: number;
  bucket: string;
  contracts: number;
}

interface AgingData {
  asOf: string;
  summary: {
    bucket_0_30: number;
    bucket_31_60: number;
    bucket_61_90: number;
    bucket_90_plus: number;
  };
  customers: AgingCustomer[];
}

const BUCKET_KEYS = OVERDUE_BUCKETS.map(bucket => bucket.key);
const BUCKET_LABELS: Record<string, string> = Object.fromEntries(OVERDUE_BUCKETS.map(b => [b.key, b.label]));
const BUCKET_BAR_COLORS: Record<string, string> = Object.fromEntries(OVERDUE_BUCKETS.map(b => [b.key, b.bar]));
const BUCKET_VALUE_COLORS: Record<string, string> = Object.fromEntries(OVERDUE_BUCKETS.map(b => [b.key, b.text]));
const BUCKET_BADGE_COLORS: Record<string, string> = Object.fromEntries(OVERDUE_BUCKETS.map(b => [b.key, b.badge]));

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export default function AgingReportPage() {
  const uiFieldId = useUiFieldId();
  const now = new Date();
  const [asOfDate, setAsOfDate] = useState(toBangkokDateString(now));
  const { cacheTtlReports } = useUiFlags();

  const {
    data: aging,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<AgingData>({
    queryKey: ['aging-report', asOfDate],
    queryFn: async () => {
      const params = new URLSearchParams({ asOf: asOfDate });
      return (await api.get(`/expenses/ledger/aging?${params}`)).data;
    },
    enabled: !!asOfDate,
    staleTime: cacheTtlReports * 1000,
  });

  return (
    <div>
      <PageHeader
        title="รายงานลูกหนี้ + วิเคราะห์อายุหนี้"
        subtitle="นับวันเกินกำหนดชำระ ไม่รวมยอดที่ยังไม่ถึงกำหนด"
        icon={<AlertTriangle className="size-6" />}
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label htmlFor={`${uiFieldId}-1`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ณ วันที่
          </label>
          <ThaiDateInput id={`${uiFieldId}-1`}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className={`${inputClass} w-auto`}
          />
        </div>
        {aging && (
          <div className="flex items-end">
            <span className="text-sm text-muted-foreground leading-snug">
              ณ วันที่ {formatDateMedium(aging.asOf)}
            </span>
          </div>
        )}
      </div>

      <QueryBoundary
        isLoading={isLoading && !aging}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายงานลูกหนี้ได้"
      >
        {aging ? (
          <>
            {/* 4 Summary Cards */}
            <div
              data-testid="aging-buckets"
              className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
            >
              {BUCKET_KEYS.map((b) => (
                <Card
                  key={b}
                  className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all"
                >
                  <div className="flex h-full">
                    <div className={`w-1 shrink-0 rounded-r-full ${BUCKET_BAR_COLORS[b]}`} />
                    <div className="p-4 flex-1">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 leading-snug">
                        {BUCKET_LABELS[b]}
                      </div>
                      <div
                        className={`text-xl font-bold tabular-nums leading-snug ${BUCKET_VALUE_COLORS[b]}`}
                      >
                        {fmt(aging.summary[b])}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Customer table */}
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
              <CardHeader>
                <h2 className="text-base font-semibold leading-snug">
                  รายชื่อลูกหนี้ค้างชำระ ({aging.customers.length} ราย)
                </h2>
              </CardHeader>
              <CardContent className="p-0">
                {aging.customers.length === 0 ? (
                  <div className="p-10 text-center text-muted-foreground leading-snug">
                    <AlertTriangle className="size-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">ไม่มีลูกหนี้ค้างชำระ ณ วันที่นี้</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm leading-snug">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium text-muted-foreground">ลูกค้า</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">โทรศัพท์</th>
                          <th className="text-right p-3 font-medium text-muted-foreground">วันค้าง</th>
                          <th className="text-right p-3 font-medium text-muted-foreground">
                            ยอดค้างชำระ
                          </th>
                          <th className="text-center p-3 font-medium text-muted-foreground">กลุ่ม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aging.customers.map((c) => (
                          <tr
                            key={c.customerId}
                            className="border-t border-border hover:bg-accent/30"
                          >
                            <td className="p-3">
                              <Link
                                to={`/customers/${c.customerId}`}
                                className="text-primary hover:underline leading-snug"
                              >
                                {c.customerName}
                              </Link>
                            </td>
                            <td className="p-3 font-mono text-sm text-muted-foreground">
                              {c.phone || '—'}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {c.daysOverdue} วัน
                            </td>
                            <td className="p-3 text-right tabular-nums font-semibold">
                              {fmt(c.totalOverdue)}
                            </td>
                            <td className="p-3 text-center">
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug ${BUCKET_BADGE_COLORS[c.bucket] ?? 'bg-muted text-muted-foreground'}`}
                              >
                                {BUCKET_LABELS[c.bucket] ?? c.bucket}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}

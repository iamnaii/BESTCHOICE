import { useState } from 'react';
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

const BUCKET_KEYS = [
  'bucket_0_30',
  'bucket_31_60',
  'bucket_61_90',
  'bucket_90_plus',
] as const;

const BUCKET_LABELS: Record<string, string> = {
  bucket_0_30: '0–30 วัน',
  bucket_31_60: '31–60 วัน',
  bucket_61_90: '61–90 วัน',
  bucket_90_plus: '90+ วัน',
};

const BUCKET_BAR_COLORS: Record<string, string> = {
  bucket_0_30: 'bg-success',
  bucket_31_60: 'bg-warning',
  bucket_61_90: 'bg-orange-500',
  bucket_90_plus: 'bg-destructive',
};

const BUCKET_VALUE_COLORS: Record<string, string> = {
  bucket_0_30: 'text-success',
  bucket_31_60: 'text-warning',
  bucket_61_90: 'text-orange-500',
  bucket_90_plus: 'text-destructive',
};

const BUCKET_BADGE_COLORS: Record<string, string> = {
  bucket_0_30: 'bg-success/10 text-success',
  bucket_31_60: 'bg-warning/10 text-warning',
  bucket_61_90: 'bg-orange-500/10 text-orange-600',
  bucket_90_plus: 'bg-destructive/10 text-destructive',
};

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export default function AgingReportPage() {
  const now = new Date();
  const [asOfDate, setAsOfDate] = useState(now.toISOString().split('T')[0]);
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
        subtitle="Aging Report — แยกตามอายุหนี้ที่ค้างชำระ"
        icon={<AlertTriangle className="size-6" />}
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ณ วันที่
          </label>
          <ThaiDateInput
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

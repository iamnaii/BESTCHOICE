import { useQuery } from '@tanstack/react-query';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import QueryBoundary from '@/components/QueryBoundary';
import { cn } from '@/lib/utils';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  BadgePercent,
  BanknoteIcon,
  RefreshCw,
  Users,
  MessageSquare,
} from 'lucide-react';
import { useNavigate } from 'react-router';

/* ─── Types ─── */

interface AgingBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  amount: number;
}

interface CollectionRate {
  current: number;
  lastMonth: number;
  mom: number;
}

interface CollectedThisMonth {
  thisMonth: number;
  count: number;
}

interface TopDelinquent {
  customerId: string;
  customerName: string;
  totalOverdue: number;
  contractCount: number;
}

interface ChannelEffectiveness {
  channel: string;
  totalSent: number;
  ledToPayment: number;
}

interface CollectionMetrics {
  agingBuckets: AgingBucket[];
  collectionRate: CollectionRate;
  collected: CollectedThisMonth;
  topDelinquent: TopDelinquent[];
  channelEffectiveness: ChannelEffectiveness[];
}

/* ─── Helper: format Thai Baht ─── */
function formatBaht(value: number): string {
  return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* ─── MoM Indicator ─── */
function MoMIndicator({ value, invertColors = false }: { value: number | null | undefined; invertColors?: boolean }) {
  if (value == null) return null;
  const isPositive = value >= 0;
  // For overdue amounts, going up is bad (invert)
  const isGood = invertColors ? !isPositive : isPositive;
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 text-xs font-medium mt-1',
        isGood ? 'text-green-600 dark:text-green-400' : 'text-destructive',
      )}
    >
      <Icon className="size-3" />
      <span>
        {isPositive ? '+' : ''}
        {value.toFixed(1)}% จากเดือนก่อน
      </span>
    </div>
  );
}

/* ─── Aging bucket color by index ─── */
const AGING_COLORS = [
  { bg: 'bg-green-500/10', bar: 'bg-green-500', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-800' },
  { bg: 'bg-yellow-500/10', bar: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-800' },
  { bg: 'bg-orange-400/10', bar: 'bg-orange-400', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800' },
  { bg: 'bg-orange-600/10', bar: 'bg-orange-600', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-300 dark:border-orange-700' },
  { bg: 'bg-red-500/10', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400', border: 'border-red-200 dark:border-red-800' },
  { bg: 'bg-red-700/10', bar: 'bg-red-700', text: 'text-red-700 dark:text-red-400', border: 'border-red-300 dark:border-red-700' },
];

/* ─── Channel label map ─── */
const CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS',
  LINE: 'LINE',
  CALL: 'โทรศัพท์',
  EMAIL: 'อีเมล',
  VISIT: 'เยี่ยมบ้าน',
};

/* ─── Main Page ─── */

export default function CollectionDashboardPage() {
  useDocumentTitle('Collection Dashboard');
  const navigate = useNavigate();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CollectionMetrics>({
    queryKey: ['collection-metrics'],
    queryFn: async () => (await api.get('/dashboard/collection-metrics')).data,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  /* ─── Derived totals ─── */
  const totalOverdue = data?.agingBuckets.reduce((sum, b) => sum + b.amount, 0) ?? 0;
  const totalOverdueCount = data?.agingBuckets.reduce((sum, b) => sum + b.count, 0) ?? 0;
  const maxBucketAmount = Math.max(...(data?.agingBuckets.map((b) => b.amount) ?? [1]), 1);
  const maxChannelSent = Math.max(...(data?.channelEffectiveness.map((c) => c.totalSent) ?? [1]), 1);

  return (
    <div className="flex flex-col gap-5 lg:gap-7.5">
      <PageHeader
        title="Collection Dashboard"
        subtitle="ติดตามและวิเคราะห์การเก็บเงินค้างชำระ"
        action={
          <div className="hidden sm:flex items-center gap-2 text-xs text-white/70 bg-white/10 border border-white/15 rounded-lg px-3 py-2">
            <RefreshCw className="size-3 animate-spin [animation-duration:10s]" />
            <span>อัปเดตอัตโนมัติทุก 60 วินาที</span>
          </div>
        }
      />

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลด Collection Dashboard ได้"
      >
        <>
          {/* ─── 4 KPI Cards ─── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
            {/* KPI: Collection Rate เดือนนี้ */}
            <Card className="overflow-hidden">
              <CardContent className="p-5 relative">
                <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-xl" />
                <div className="pl-2">
                  <div className="flex items-center justify-between mb-4">
                    <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <BadgePercent className="size-5 text-primary" />
                    </div>
                    <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      เดือนนี้
                    </span>
                  </div>
                  <div className="text-2xl lg:text-3xl font-bold text-foreground">
                    {(data?.collectionRate.current ?? 0).toFixed(1)}%
                  </div>
                  <div className="text-xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
                    Collection Rate
                  </div>
                  <MoMIndicator value={data?.collectionRate.mom} />
                </div>
              </CardContent>
            </Card>

            {/* KPI: เก็บได้เดือนนี้ */}
            <Card
              className="overflow-hidden cursor-pointer group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              onClick={() => navigate('/payments')}
            >
              <CardContent className="p-5 relative">
                <div className="absolute inset-y-0 left-0 w-1 bg-green-500 rounded-l-xl" />
                <div className="pl-2">
                  <div className="flex items-center justify-between mb-4">
                    <div className="size-10 rounded-xl bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                      <TrendingUp className="size-5 text-green-600 dark:text-green-400" />
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {data?.collected.count ?? 0} รายการ
                    </span>
                  </div>
                  <div className="text-xl lg:text-2xl font-bold text-foreground truncate">
                    {formatBaht(data?.collected.thisMonth ?? 0)}
                  </div>
                  <div className="text-xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
                    เก็บได้เดือนนี้
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* KPI: ยอดค้างทั้งหมด */}
            <Card
              className="overflow-hidden cursor-pointer group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              onClick={() => navigate('/overdue')}
            >
              <CardContent className="p-5 relative">
                <div className="absolute inset-y-0 left-0 w-1 bg-destructive rounded-l-xl" />
                <div className="pl-2">
                  <div className="flex items-center justify-between mb-4">
                    <div className="size-10 rounded-xl bg-destructive/10 flex items-center justify-center group-hover:bg-destructive/20 transition-colors">
                      <AlertTriangle className="size-5 text-destructive" />
                    </div>
                    <span className="text-xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                      {totalOverdueCount} สัญญา
                    </span>
                  </div>
                  <div className="text-xl lg:text-2xl font-bold text-foreground truncate">
                    {formatBaht(totalOverdue)}
                  </div>
                  <div className="text-xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
                    ยอดค้างทั้งหมด
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* KPI: Collection Rate เดือนก่อน */}
            <Card className="overflow-hidden">
              <CardContent className="p-5 relative">
                <div className="absolute inset-y-0 left-0 w-1 bg-muted-foreground/40 rounded-l-xl" />
                <div className="pl-2">
                  <div className="flex items-center justify-between mb-4">
                    <div className="size-10 rounded-xl bg-muted flex items-center justify-center">
                      <TrendingDown className="size-5 text-muted-foreground" />
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      เดือนก่อน
                    </span>
                  </div>
                  <div className="text-2xl lg:text-3xl font-bold text-foreground">
                    {(data?.collectionRate.lastMonth ?? 0).toFixed(1)}%
                  </div>
                  <div className="text-xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
                    Collection Rate เดือนก่อน
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ─── Aging Buckets ─── */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Aging Buckets — สัดส่วนหนี้ค้างตามอายุ
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {(data?.agingBuckets ?? []).map((bucket, idx) => {
                const colors = AGING_COLORS[idx % AGING_COLORS.length];
                const barWidth = totalOverdue > 0 ? (bucket.amount / maxBucketAmount) * 100 : 0;
                return (
                  <Card key={bucket.label} className={cn('overflow-hidden border', colors.border)}>
                    <CardContent className="p-4">
                      <div className={cn('text-xs font-semibold mb-1', colors.text)}>{bucket.label} วัน</div>
                      <div className="text-xl font-bold text-foreground">{bucket.count.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground mb-2">สัญญา</div>
                      {/* Mini bar */}
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
                        <div
                          className={cn('h-full rounded-full transition-all duration-500', colors.bar)}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <div className={cn('text-xs font-medium', colors.text)}>
                        {formatBaht(bucket.amount)}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* ─── Two-column section ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Left: ลูกค้าค้างชำระสูงสุด */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-destructive" />
                  <CardTitle className="text-sm font-semibold">ลูกค้าค้างชำระสูงสุด</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {(data?.topDelinquent ?? []).length === 0 ? (
                  <div className="text-center py-10 text-sm text-muted-foreground">ไม่มีข้อมูล</div>
                ) : (
                  <div className="divide-y divide-border">
                    {(data?.topDelinquent ?? []).slice(0, 10).map((item, idx) => (
                      <div
                        key={item.customerId}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors cursor-pointer"
                        onClick={() => navigate(`/customers/${item.customerId}`)}
                      >
                        {/* Rank */}
                        <div
                          className={cn(
                            'size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                            idx === 0
                              ? 'bg-red-500 text-white'
                              : idx === 1
                              ? 'bg-orange-500 text-white'
                              : idx === 2
                              ? 'bg-yellow-500 text-white'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {idx + 1}
                        </div>
                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{item.customerName}</div>
                          <div className="text-xs text-muted-foreground">{item.contractCount} สัญญา</div>
                        </div>
                        {/* Amount */}
                        <div className="text-sm font-semibold text-destructive shrink-0">
                          {formatBaht(item.totalOverdue)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right: ประสิทธิภาพช่องทางทวงหนี้ */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">ประสิทธิภาพช่องทางทวงหนี้</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {(data?.channelEffectiveness ?? []).length === 0 ? (
                  <div className="text-center py-10 text-sm text-muted-foreground">ไม่มีข้อมูล</div>
                ) : (
                  (data?.channelEffectiveness ?? []).map((ch) => {
                    const rate = ch.totalSent > 0 ? (ch.ledToPayment / ch.totalSent) * 100 : 0;
                    const barWidth = maxChannelSent > 0 ? (ch.totalSent / maxChannelSent) * 100 : 0;
                    return (
                      <div key={ch.channel} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">
                            {CHANNEL_LABELS[ch.channel] ?? ch.channel}
                          </span>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>ส่ง {ch.totalSent.toLocaleString()}</span>
                            <span className="font-semibold text-primary">{rate.toFixed(1)}%</span>
                          </div>
                        </div>
                        {/* Dual bar: totalSent (gray) with ledToPayment overlay (primary) */}
                        <div className="h-2 rounded-full bg-muted overflow-hidden relative">
                          <div
                            className="absolute inset-y-0 left-0 bg-muted-foreground/20 rounded-full"
                            style={{ width: `${barWidth}%` }}
                          />
                          <div
                            className="absolute inset-y-0 left-0 bg-primary rounded-full"
                            style={{ width: `${barWidth * (rate / 100)}%` }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          นำไปสู่การชำระ {ch.ledToPayment.toLocaleString()} ราย
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </>
      </QueryBoundary>
    </div>
  );
}

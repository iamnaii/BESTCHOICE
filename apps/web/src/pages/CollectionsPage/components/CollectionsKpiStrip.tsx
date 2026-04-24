import { Card, CardContent } from '@/components/ui/card';
import { useCollectionsKpi } from '../hooks/useCollectionsKpi';

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  strip: string;
  loading?: boolean;
}

function KpiCard({ label, value, subtitle, strip, loading }: KpiCardProps) {
  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
      <div className="flex h-full">
        <div className={`w-1 shrink-0 ${strip}`} />
        <CardContent className="p-5 flex-1">
          <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2 leading-snug">
            {label}
          </div>
          {loading ? (
            <div className="bg-muted animate-pulse h-7 rounded w-24 mb-1" />
          ) : (
            <div className="text-2xl font-bold tabular-nums leading-snug">{value}</div>
          )}
          {subtitle && !loading && (
            <div className="text-xs text-muted-foreground mt-1 leading-snug">{subtitle}</div>
          )}
          {loading && (
            <div className="bg-muted animate-pulse h-3 rounded w-32 mt-2 opacity-60" />
          )}
        </CardContent>
      </div>
    </Card>
  );
}

export default function CollectionsKpiStrip() {
  const { data, isLoading, isError, refetch } = useCollectionsKpi('7d');

  if (isError) {
    return (
      <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-center justify-between">
        <span className="text-sm text-destructive leading-snug">ไม่สามารถโหลด KPI ได้</span>
        <button
          onClick={() => refetch()}
          className="px-3 py-1.5 text-xs border border-destructive/30 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  const trend = data?.queueTodayTrend ?? 0;
  const trendEl =
    trend !== 0 ? (
      <span className={trend > 0 ? 'text-destructive' : 'text-success'}>
        {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(0)}%
      </span>
    ) : (
      <span>วันนี้</span>
    );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
      <KpiCard
        label="ค้างรวม"
        strip="bg-destructive"
        loading={isLoading}
        value={
          <span>
            {data?.totalOutstanding.toLocaleString() ?? '-'}{' '}
            <span className="text-base font-medium">฿</span>
          </span>
        }
        subtitle={
          data ? (
            <span>
              + ค่าปรับ{' '}
              <span className="tabular-nums text-destructive font-medium">
                {data.totalLateFees.toLocaleString()}
              </span>{' '}
              ฿
            </span>
          ) : undefined
        }
      />
      <KpiCard
        label="คิววันนี้"
        strip="bg-primary"
        loading={isLoading}
        value={<span className="text-primary">{data?.queueToday ?? '-'}</span>}
        subtitle={trendEl}
      />
      <KpiCard
        label="นัดชำระ"
        strip="bg-warning"
        loading={isLoading}
        value={<span>{data?.promisedCount ?? '-'}</span>}
        subtitle="รอชำระตามนัด"
      />
      <KpiCard
        label="Promise-kept 7d"
        strip="bg-success"
        loading={isLoading}
        value={
          data ? (
            <span className="text-success">
              {(data.promiseKeptRate7d * 100).toFixed(0)}%
            </span>
          ) : (
            '-'
          )
        }
        subtitle="ช่วง 7 วันล่าสุด"
      />
    </div>
  );
}

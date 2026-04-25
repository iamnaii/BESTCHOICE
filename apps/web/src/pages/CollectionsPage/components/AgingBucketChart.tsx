import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import QueryBoundary from '@/components/QueryBoundary';
import { useAnalyticsAging, type AgingBucketCode } from '../hooks/useAnalyticsAging';

// Color ramp by severity — emerald (fresh) → red (worst)
const BUCKET_COLOR: Record<AgingBucketCode, string> = {
  '1-7': '#10b981',
  '8-30': '#f59e0b',
  '31-60': '#f97316',
  '61-90': '#ef4444',
  '90+': '#7f1d1d',
};

const AXIS_STYLE = { stroke: '#a1a1aa', fontSize: 11 };
const GRID_PROPS = { strokeDasharray: '3 3', stroke: '#e4e4e7' };

function formatBaht(n: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(n);
}

export default function AgingBucketChart() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'count' | 'outstanding'>('count');
  const { data = [], isLoading, isError, error, refetch } = useAnalyticsAging();

  const chartData = useMemo(
    () =>
      data.map((r) => ({
        bucket: r.bucket,
        value: mode === 'count' ? r.count : r.outstanding,
      })),
    [data, mode],
  );

  const handleBarClick = (payload: { bucket?: AgingBucketCode } | undefined) => {
    if (!payload?.bucket) return;
    // Deep-link into QueueTab with bucket filter applied (URL param). The
    // queue filter hook reads `q_buckets` (csv) — switch to default 'today'
    // tab and pre-seed filter.
    const params = new URLSearchParams(window.location.search);
    params.set('q_buckets', payload.bucket);
    navigate(`/collections?${params.toString()}#today`);
  };

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-sm font-semibold mb-0.5 leading-snug">
              ค้างชำระ — แยกตามอายุหนี้
            </div>
            <div className="text-xs text-muted-foreground leading-snug">
              คลิกแถบเพื่อกรองคิวงาน
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={mode === 'count' ? 'font-medium' : 'text-muted-foreground'}>
              นับสัญญา
            </span>
            <Switch
              checked={mode === 'outstanding'}
              onCheckedChange={(v) => setMode(v ? 'outstanding' : 'count')}
              aria-label="สลับโหมดแสดงผล: นับ/ยอด"
            />
            <span
              className={mode === 'outstanding' ? 'font-medium' : 'text-muted-foreground'}
            >
              ยอดค้าง (บาท)
            </span>
          </div>
        </div>

        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดข้อมูลอายุหนี้ได้"
        >
          <div style={{ width: '100%', height: 240 }}>
            {chartData.every((d) => d.value === 0) ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic leading-snug">
                ยังไม่มีข้อมูล
              </div>
            ) : (
              <ResponsiveContainer>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 4, left: 24 }}
                >
                  <CartesianGrid {...GRID_PROPS} horizontal={false} />
                  <XAxis
                    type="number"
                    {...AXIS_STYLE}
                    tickFormatter={(v) =>
                      mode === 'outstanding' ? formatBaht(v) : String(v)
                    }
                  />
                  <YAxis dataKey="bucket" type="category" {...AXIS_STYLE} width={56} />
                  <Tooltip
                    formatter={(v: number) =>
                      mode === 'outstanding'
                        ? [`${formatBaht(v)} บาท`, 'ยอดค้าง']
                        : [`${v} สัญญา`, 'จำนวน']
                    }
                    labelFormatter={(l) => `${l} วัน`}
                  />
                  <Bar
                    dataKey="value"
                    onClick={(d) => handleBarClick(d as { bucket?: AgingBucketCode })}
                    cursor="pointer"
                  >
                    {chartData.map((d) => (
                      <Cell key={d.bucket} fill={BUCKET_COLOR[d.bucket as AgingBucketCode]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

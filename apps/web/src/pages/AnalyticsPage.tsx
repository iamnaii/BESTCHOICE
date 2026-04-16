import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Users, BarChart3, Calendar } from 'lucide-react';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CohortData {
  cohorts: { month: string; customers: number; retention: number[] }[];
  maxOffset: number;
  generatedAt: string;
}

interface ForecastData {
  historical: { month: string; amount: number }[];
  forecast: { month: string; amount: number; lower: number; upper: number; confidence: number }[];
  trend: 'up' | 'down' | 'flat';
  monthlyGrowthRate: number;
  note?: string;
}

interface HeatmapEntry {
  day: number;
  hour: number;
  count: number;
  amount: number;
}

interface HeatmapData {
  heatmap: HeatmapEntry[];
  dayNames: string[];
  peakDay: { day: number; name: string } | null;
  peakHour: number | null;
  periodMonths: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBaht(v: number) {
  return v.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function retentionColor(pct: number) {
  if (pct >= 80) return 'bg-emerald-600 text-white';
  if (pct >= 60) return 'bg-emerald-400 text-white';
  if (pct >= 40) return 'bg-yellow-400 text-foreground';
  if (pct >= 20) return 'bg-orange-400 text-white';
  if (pct > 0) return 'bg-red-400 text-white';
  return 'bg-gray-100 text-gray-400';
}

function heatmapColor(value: number, max: number) {
  if (max === 0) return '#f3f4f6';
  const intensity = value / max;
  if (intensity === 0) return '#f3f4f6';
  const r = Math.round(255 - intensity * (255 - 59));
  const g = Math.round(255 - intensity * (255 - 130));
  const b = Math.round(255 - intensity * (255 - 246));
  return `rgb(${r},${g},${b})`;
}

// ─── Cohort Table ─────────────────────────────────────────────────────────────

function CohortTable({ data }: { data: CohortData }) {
  const offsets = Array.from({ length: data.maxOffset + 1 }, (_, i) => i);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card px-3 py-2 text-left font-semibold text-foreground/70 border-b border-r min-w-[100px]">
              เดือน
            </th>
            <th className="px-2 py-2 text-right font-semibold text-foreground/70 border-b border-r min-w-[60px]">
              ลูกค้า
            </th>
            {offsets.map((o) => (
              <th
                key={o}
                className="px-2 py-2 text-center font-semibold text-muted-foreground border-b min-w-[48px]"
              >
                M+{o}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.cohorts.map((cohort) => (
            <tr key={cohort.month} className="hover:bg-muted/50">
              <td className="sticky left-0 bg-card px-3 py-1.5 font-medium text-foreground/80 border-r border-b">
                {cohort.month}
              </td>
              <td className="px-2 py-1.5 text-right text-foreground/70 border-r border-b">
                {cohort.customers}
              </td>
              {offsets.map((o) => {
                const pct = cohort.retention[o] ?? 0;
                return (
                  <td
                    key={o}
                    className={`px-2 py-1.5 text-center border-b ${retentionColor(pct)}`}
                  >
                    {pct > 0 ? `${pct}%` : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 mt-3 flex-wrap items-center">
        <span className="text-xs text-muted-foreground">สี:</span>
        {[
          { label: '≥80%', cls: 'bg-emerald-600' },
          { label: '60–79%', cls: 'bg-emerald-400' },
          { label: '40–59%', cls: 'bg-yellow-400' },
          { label: '20–39%', cls: 'bg-orange-400' },
          { label: '<20%', cls: 'bg-red-400' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1 text-xs">
            <span className={`inline-block w-3 h-3 rounded ${item.cls}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Revenue Forecast Chart ───────────────────────────────────────────────────

function RevenueForecastChart({ data }: { data: ForecastData }) {
  const combined = [
    ...data.historical.map((h) => ({ ...h, type: 'historical' as const })),
    ...data.forecast.map((f) => ({ ...f, type: 'forecast' as const })),
  ];

  const lastHistoricalMonth = data.historical[data.historical.length - 1]?.month;

  const TrendIcon =
    data.trend === 'up' ? TrendingUp : data.trend === 'down' ? TrendingDown : Minus;
  const trendColor =
    data.trend === 'up'
      ? 'text-emerald-600'
      : data.trend === 'down'
        ? 'text-red-500'
        : 'text-muted-foreground';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <TrendIcon className={`w-5 h-5 ${trendColor}`} aria-hidden="true" />
        <span className={`text-sm font-medium ${trendColor}`}>
          {data.trend === 'up'
            ? `แนวโน้มขึ้น +${data.monthlyGrowthRate}%/เดือน`
            : data.trend === 'down'
              ? `แนวโน้มลง ${data.monthlyGrowthRate}%/เดือน`
              : 'แนวโน้มคงที่'}
        </span>
      </div>

      {data.note && (
        <p className="text-sm text-amber-600 bg-amber-50 rounded p-2">{data.note}</p>
      )}

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={combined} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`}
            width={60}
          />
          <Tooltip
            formatter={(value: unknown) => [`฿${formatBaht(Number(value))}`, 'รายได้']}
            labelStyle={{ fontSize: 12 }}
          />
          {lastHistoricalMonth && (
            <ReferenceLine
              x={lastHistoricalMonth}
              stroke="var(--color-muted-foreground, #94a3b8)"
              strokeDasharray="4 4"
              label={{ value: 'ปัจจุบัน', position: 'top', fontSize: 10, fill: '#64748b' }}
            />
          )}
          <Line
            dataKey="amount"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              return payload.type === 'forecast' ? (
                <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill="#f59e0b" stroke="#f59e0b" />
              ) : (
                <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill="#3b82f6" stroke="#3b82f6" />
              );
            }}
            strokeDasharray="0"
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>

      {data.forecast.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {data.forecast.map((f) => (
            <div key={f.month} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
              <p className="text-xs text-amber-600 font-medium">{f.month}</p>
              <p className="text-lg font-bold text-foreground/90 mt-1">฿{formatBaht(f.amount)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatBaht(f.lower)} – {formatBaht(f.upper)}
              </p>
              <p className="text-xs text-amber-500">{f.confidence}% confidence</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sales Heatmap ────────────────────────────────────────────────────────────

function SalesHeatmapGrid({ data }: { data: HeatmapData }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const days = [0, 1, 2, 3, 4, 5, 6];

  // Build lookup map
  const lookup: Record<string, HeatmapEntry> = {};
  for (const entry of data.heatmap) {
    lookup[`${entry.day}-${entry.hour}`] = entry;
  }

  const maxCount = Math.max(...data.heatmap.map((e) => e.count), 1);

  return (
    <div className="space-y-3">
      {data.peakDay && data.peakHour !== null && (
        <p className="text-sm text-foreground/70">
          Peak: <strong>{data.peakDay.name}</strong> เวลา <strong>{data.peakHour}:00</strong>
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-muted-foreground min-w-[52px]">วัน\ชม.</th>
              {hours.map((h) => (
                <th key={h} className="px-1 py-1 text-center text-muted-foreground min-w-[28px]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td className="px-2 py-1 font-medium text-foreground/70">{data.dayNames[d]}</td>
                {hours.map((h) => {
                  const entry = lookup[`${d}-${h}`];
                  const count = entry?.count || 0;
                  const bg = heatmapColor(count, maxCount);
                  return (
                    <td
                      key={h}
                      title={entry ? `${count} รายการ ฿${formatBaht(entry.amount)}` : '0'}
                      style={{ backgroundColor: bg }}
                      className="w-7 h-7 text-center border border-border cursor-default"
                      aria-label={`วัน${data.dayNames[d]} ชั่วโมง ${h}: ${count} รายการ`}
                    >
                      {count > 0 ? count : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>น้อย</span>
        <div className="flex gap-0.5">
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <span
              key={v}
              className="inline-block w-4 h-4 rounded-sm"
              style={{ backgroundColor: heatmapColor(v * maxCount, maxCount) }}
            />
          ))}
        </div>
        <span>มาก</span>
      </div>
    </div>
  );
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

type Tab = 'cohort' | 'forecast' | 'heatmap';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'cohort', label: 'Cohort Retention', icon: Users },
  { id: 'forecast', label: 'Revenue Forecast', icon: TrendingUp },
  { id: 'heatmap', label: 'Sales Heatmap', icon: BarChart3 },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('cohort');

  const cohortQuery = useQuery<CohortData>({
    queryKey: ['analytics', 'cohort'],
    queryFn: async () => {
      const { data } = await api.get<CohortData>('/reports/cohort-analysis');
      return data;
    },
    enabled: activeTab === 'cohort',
    staleTime: 5 * 60 * 1000,
  });

  const forecastQuery = useQuery<ForecastData>({
    queryKey: ['analytics', 'forecast'],
    queryFn: async () => {
      const { data } = await api.get<ForecastData>('/reports/revenue-forecast');
      return data;
    },
    enabled: activeTab === 'forecast',
    staleTime: 5 * 60 * 1000,
  });

  const heatmapQuery = useQuery<HeatmapData>({
    queryKey: ['analytics', 'heatmap'],
    queryFn: async () => {
      const { data } = await api.get<HeatmapData>('/reports/sales-heatmap');
      return data;
    },
    enabled: activeTab === 'heatmap',
    staleTime: 5 * 60 * 1000,
  });

  const activeQuery =
    activeTab === 'cohort' ? cohortQuery : activeTab === 'forecast' ? forecastQuery : heatmapQuery;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Analytics Dashboard"
        subtitle="วิเคราะห์ข้อมูลเชิงลึก: cohort retention, พยากรณ์รายได้, และ sales heatmap"
        icon={<BarChart3 className="w-6 h-6" aria-hidden="true" />}
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-card border border-b-card border-border text-blue-600 -mb-px'
                  : 'text-muted-foreground hover:text-foreground/80 hover:bg-muted'
              }`}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <QueryBoundary
        isLoading={activeQuery.isLoading}
        isError={activeQuery.isError}
        error={activeQuery.error}
        onRetry={() => activeQuery.refetch()}
        errorTitle="ไม่สามารถโหลดข้อมูลได้"
      >
        {activeTab === 'cohort' && cohortQuery.data && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Cohort Retention Analysis</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    ติดตามว่าลูกค้าในแต่ละ cohort ยังคงชำระเงินอยู่กี่เปอร์เซ็นต์ในเดือนถัดไป
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                  อัปเดต: {new Date(cohortQuery.data.generatedAt).toLocaleString('th-TH')}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {cohortQuery.data.cohorts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">ยังไม่มีข้อมูล cohort</p>
              ) : (
                <CohortTable data={cohortQuery.data} />
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'forecast' && forecastQuery.data && (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-foreground">Revenue Forecast</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                พยากรณ์รายได้ 3 เดือนข้างหน้าจากข้อมูลย้อนหลัง 6 เดือน (linear regression)
              </p>
            </CardHeader>
            <CardContent>
              <RevenueForecastChart data={forecastQuery.data} />
            </CardContent>
          </Card>
        )}

        {activeTab === 'heatmap' && heatmapQuery.data && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Sales Heatmap</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    ยอดขายตามวันและชั่วโมง (ข้อมูล {heatmapQuery.data.periodMonths} เดือนล่าสุด)
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <SalesHeatmapGrid data={heatmapQuery.data} />
            </CardContent>
          </Card>
        )}
      </QueryBoundary>
    </div>
  );
}

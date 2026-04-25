import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { subDays, startOfDay, endOfDay } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import QueryBoundary from '@/components/QueryBoundary';
import { DateRangePicker, type DateRangeValue } from '@/components/ui/DateRangePicker';
import { useCollectionsAnalytics } from '../hooks/useCollectionsAnalytics';
import AgingBucketChart from '../components/AgingBucketChart';
import LeaderboardTable from '../components/LeaderboardTable';
import StuckContractsSection from '../components/StuckContractsSection';
import RecoveryByChannelChart from './AnalyticsTab/RecoveryByChannelChart';
import ComplianceDashboardSection from './AnalyticsTab/ComplianceDashboardSection';
import WorkloadGrid from '../components/WorkloadGrid';
import PdfExportButton from '../components/PdfExportButton';
import { useAuth } from '@/contexts/AuthContext';

// Chart colors: pragmatic hex approximations of the theme palette.
// recharts requires explicit color values; these match emerald/red/amber tokens.
const CHART_COLORS = {
  success: '#10b981', // emerald-500 — matches theme primary
  destructive: '#ef4444', // red-500
  warning: '#f59e0b', // amber-500
  muted: '#a1a1aa', // zinc-400
};

const AXIS_STYLE = { stroke: '#a1a1aa', fontSize: 11 };
const GRID_PROPS = { strokeDasharray: '3 3', stroke: '#e4e4e7' };

function Empty() {
  return (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic leading-snug">
      ยังไม่มีข้อมูล
    </div>
  );
}

// Pivot letter dispatch rows into per-month objects keyed by type
function pivotLetters(
  items: Array<{ type: string; month: string; count: number }>,
): Array<Record<string, string | number>> {
  const months = Array.from(new Set(items.map((i) => i.month))).sort();
  return months.map((m) => {
    const row: Record<string, string | number> = { month: m.slice(0, 7) };
    for (const item of items.filter((i) => i.month === m)) {
      row[item.type] = item.count;
    }
    return row;
  });
}

// Map custom date range -> backend range enum (P0: avoid backend change).
// Rule: diff days ≤ 45 → '30d', otherwise → '90d'.
function mapRangeToEnum(value: DateRangeValue): '30d' | '90d' {
  if (!value.from || !value.to) return '30d';
  const days = Math.round((value.to.getTime() - value.from.getTime()) / 86400000);
  return days <= 45 ? '30d' : '90d';
}

function defaultRange(): DateRangeValue {
  const now = new Date();
  return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
}

export default function AnalyticsTab() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [dateRange, setDateRange] = useState<DateRangeValue>(defaultRange);
  const range = useMemo(() => mapRangeToEnum(dateRange), [dateRange]);
  const { data, isLoading, isError, error, refetch } = useCollectionsAnalytics(range);

  return (
    <div>
      {/* Date range picker + PDF export */}
      <div className="flex justify-end items-center gap-2 mb-4">
        {isOwner && <PdfExportButton />}
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดข้อมูลวิเคราะห์ได้"
      >
        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Aging buckets — span full width above 5 trend cards */}
            <AgingBucketChart />

            {/* OWNER-only sections */}
            {isOwner && <LeaderboardTable />}
            {isOwner && <StuckContractsSection />}
            {/* Card 1 — weekly collection rate */}
            <Card>
              <CardContent className="p-5">
                <div className="text-sm font-semibold mb-0.5 leading-snug">
                  อัตราการเก็บเงินรายสัปดาห์
                </div>
                <div className="text-xs text-muted-foreground mb-4 leading-snug">
                  % งวดที่ชำระในแต่ละสัปดาห์
                </div>
                <div style={{ width: '100%', height: 220 }}>
                  {data.weeklyCollectionRate.length === 0 ? (
                    <Empty />
                  ) : (
                    <ResponsiveContainer>
                      <LineChart
                        data={data.weeklyCollectionRate.map((w) => ({
                          week: w.weekStart.slice(5, 10),
                          rate: Math.round(w.rate * 100),
                        }))}
                      >
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="week" {...AXIS_STYLE} />
                        <YAxis
                          {...AXIS_STYLE}
                          domain={[0, 100]}
                          tickFormatter={(v) => `${v}%`}
                        />
                        <Tooltip
                          formatter={(v) => [`${v}%`, 'อัตราชำระ']}
                          labelFormatter={(l) => `สัปดาห์ ${l}`}
                        />
                        <Line
                          type="monotone"
                          dataKey="rate"
                          stroke={CHART_COLORS.success}
                          strokeWidth={2}
                          dot={{ r: 3, fill: CHART_COLORS.success }}
                          name="อัตราชำระ"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Card 2 — promise kept vs broken */}
            <Card>
              <CardContent className="p-5">
                <div className="text-sm font-semibold mb-0.5 leading-snug">
                  นัดชำระ: ได้ตามนัด vs ผิดนัด
                </div>
                <div className="text-xs text-muted-foreground mb-4 leading-snug">รายสัปดาห์</div>
                <div style={{ width: '100%', height: 220 }}>
                  {data.promiseKeptTrend.length === 0 ? (
                    <Empty />
                  ) : (
                    <ResponsiveContainer>
                      <BarChart
                        data={data.promiseKeptTrend.map((w) => ({
                          week: w.weekStart.slice(5, 10),
                          ตามนัด: w.kept,
                          ผิดนัด: w.broken,
                        }))}
                      >
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="week" {...AXIS_STYLE} />
                        <YAxis {...AXIS_STYLE} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="ตามนัด" stackId="p" fill={CHART_COLORS.success} />
                        <Bar dataKey="ผิดนัด" stackId="p" fill={CHART_COLORS.destructive} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Card 3 — dunning action volume */}
            <Card>
              <CardContent className="p-5">
                <div className="text-sm font-semibold mb-0.5 leading-snug">
                  การแจ้งเตือน LINE/SMS
                </div>
                <div className="text-xs text-muted-foreground mb-4 leading-snug">
                  สำเร็จ vs ล้มเหลว รายวัน
                </div>
                <div style={{ width: '100%', height: 220 }}>
                  {data.dunningActionVolume.length === 0 ? (
                    <Empty />
                  ) : (
                    <ResponsiveContainer>
                      <LineChart
                        data={data.dunningActionVolume.map((d) => ({
                          day: d.date.slice(5, 10),
                          สำเร็จ: d.sent,
                          ล้มเหลว: d.failed,
                        }))}
                      >
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="day" {...AXIS_STYLE} />
                        <YAxis {...AXIS_STYLE} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line
                          type="monotone"
                          dataKey="สำเร็จ"
                          stroke={CHART_COLORS.success}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="ล้มเหลว"
                          stroke={CHART_COLORS.destructive}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Card 4 — letter dispatch by type */}
            <Card>
              <CardContent className="p-5">
                <div className="text-sm font-semibold mb-0.5 leading-snug">หนังสือที่ส่ง</div>
                <div className="text-xs text-muted-foreground mb-4 leading-snug">
                  รายเดือน · แยกประเภท
                </div>
                <div style={{ width: '100%', height: 220 }}>
                  {data.letterDispatchByType.length === 0 ? (
                    <Empty />
                  ) : (
                    <ResponsiveContainer>
                      <BarChart data={pivotLetters(data.letterDispatchByType)}>
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="month" {...AXIS_STYLE} />
                        <YAxis {...AXIS_STYLE} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar
                          dataKey="RETURN_DEVICE_45D"
                          fill={CHART_COLORS.warning}
                          name="ทวงถาม 45 วัน"
                        />
                        <Bar
                          dataKey="CONTRACT_TERMINATION_60D"
                          fill={CHART_COLORS.destructive}
                          name="บอกเลิก 60 วัน"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Card 5 — MDM lock volume (full width) */}
            <Card className="lg:col-span-2">
              <CardContent className="p-5">
                <div className="text-sm font-semibold mb-0.5 leading-snug">
                  การเสนอและอนุมัติล็อคเครื่อง
                </div>
                <div className="text-xs text-muted-foreground mb-4 leading-snug">รายวัน</div>
                <div style={{ width: '100%', height: 220 }}>
                  {data.mdmLockVolume.length === 0 ? (
                    <Empty />
                  ) : (
                    <ResponsiveContainer>
                      <LineChart
                        data={data.mdmLockVolume.map((d) => ({
                          day: d.date.slice(5, 10),
                          เสนอ: d.proposed,
                          อนุมัติ: d.approved,
                        }))}
                      >
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="day" {...AXIS_STYLE} />
                        <YAxis {...AXIS_STYLE} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line
                          type="monotone"
                          dataKey="เสนอ"
                          stroke={CHART_COLORS.warning}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="อนุมัติ"
                          stroke={CHART_COLORS.success}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* P2 Task 8 — Recovery rate by dunning channel */}
            <RecoveryByChannelChart from={dateRange.from} to={dateRange.to} />

            {/* P2 Task 9 — Workload redistribution drag-drop (OWNER only) */}
            {isOwner && <WorkloadGrid />}

            {/* P3 D2 — Compliance dashboard (OWNER + FINANCE_MANAGER) */}
            {(isOwner || user?.role === 'FINANCE_MANAGER') && <ComplianceDashboardSection />}
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

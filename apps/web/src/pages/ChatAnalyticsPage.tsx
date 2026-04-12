import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { BarChart3, Clock, Users, Bot } from 'lucide-react';

type RangeKey = '7d' | '30d' | '90d';

const RANGE_OPTIONS: { key: RangeKey; label: string; days: number }[] = [
  { key: '7d', label: '7 วัน', days: 7 },
  { key: '30d', label: '30 วัน', days: 30 },
  { key: '90d', label: '90 วัน', days: 90 },
];

function useDateRange(rangeKey: RangeKey) {
  return useMemo(() => {
    const days = RANGE_OPTIONS.find((r) => r.key === rangeKey)!.days;
    const end = new Date();
    const start = new Date(Date.now() - days * 86400000);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }, [rangeKey]);
}

interface OverviewData {
  totalSessions: number;
  resolutionRate: number;
  handoffRate: number;
  aiRatio: number;
}

interface ChannelData {
  channel: string;
  count: number;
}

interface ResponseTimeData {
  avgMinutes: number;
  sampleSize: number;
}

interface StaffData {
  staffId: string;
  staffName: string;
  resolvedCount: number;
  avgResponseMinutes: number;
}

export default function ChatAnalyticsPage() {
  const [range, setRange] = useState<RangeKey>('30d');
  const { startDate, endDate } = useDateRange(range);
  const params = { startDate, endDate };

  const overviewQ = useQuery<OverviewData>({
    queryKey: ['chat-analytics', 'overview', range],
    queryFn: () => api.get('/chat-analytics/overview', { params }).then((r: any) => r.data),
  });

  const channelsQ = useQuery<ChannelData[]>({
    queryKey: ['chat-analytics', 'channels', range],
    queryFn: () => api.get('/chat-analytics/channels', { params }).then((r: any) => r.data),
  });

  const responseTimeQ = useQuery<ResponseTimeData>({
    queryKey: ['chat-analytics', 'response-time', range],
    queryFn: () => api.get('/chat-analytics/response-time', { params }).then((r: any) => r.data),
  });

  const staffQ = useQuery<StaffData[]>({
    queryKey: ['chat-analytics', 'staff-performance', range],
    queryFn: () =>
      api.get('/chat-analytics/staff-performance', { params }).then((r: any) => r.data),
  });

  const isLoading =
    overviewQ.isLoading || channelsQ.isLoading || responseTimeQ.isLoading || staffQ.isLoading;
  const isError =
    overviewQ.isError || channelsQ.isError || responseTimeQ.isError || staffQ.isError;
  const error = overviewQ.error || channelsQ.error || responseTimeQ.error || staffQ.error;

  const refetchAll = () => {
    overviewQ.refetch();
    channelsQ.refetch();
    responseTimeQ.refetch();
    staffQ.refetch();
  };

  const overview = overviewQ.data;
  const channels = channelsQ.data ?? [];
  const responseTime = responseTimeQ.data;
  const staff = staffQ.data ?? [];
  const maxChannelCount = Math.max(...channels.map((c) => c.count), 1);

  return (
    <div>
      <PageHeader title="วิเคราะห์แชท" subtitle="สถิติการสนทนา ประสิทธิภาพทีม" />

      {/* Date range selector */}
      <div className="flex gap-2 mb-6">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setRange(opt.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              range === opt.key
                ? 'bg-primary text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetchAll}>
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KpiCard
            icon={<BarChart3 className="h-5 w-5" />}
            label="เซสชันทั้งหมด"
            value={overview?.totalSessions ?? 0}
          />
          <KpiCard
            icon={<Users className="h-5 w-5" />}
            label="อัตราแก้ไขสำเร็จ"
            value={`${overview?.resolutionRate ?? 0}%`}
          />
          <KpiCard
            icon={<Users className="h-5 w-5" />}
            label="อัตรา Handoff"
            value={`${overview?.handoffRate ?? 0}%`}
          />
          <KpiCard
            icon={<Bot className="h-5 w-5" />}
            label="สัดส่วน AI"
            value={`${overview?.aiRatio ?? 0}%`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Channel volume */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground mb-4">ปริมาณแชทตามช่องทาง</h2>
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">ไม่มีข้อมูล</p>
            ) : (
              <div className="space-y-3">
                {channels.map((ch) => (
                  <div key={ch.channel}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-foreground">{ch.channel}</span>
                      <span className="text-sm font-medium text-foreground">
                        {ch.count.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(ch.count / maxChannelCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Response time */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground mb-4">
              เวลาตอบกลับเฉลี่ย (First Response)
            </h2>
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-primary" />
              <div>
                <p className="text-3xl font-bold text-foreground">
                  {responseTime?.avgMinutes ?? 0} <span className="text-base font-normal">นาที</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  จากตัวอย่าง {responseTime?.sampleSize ?? 0} เซสชัน
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Staff performance table */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground mb-4">ประสิทธิภาพพนักงาน</h2>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">ไม่มีข้อมูล</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium text-muted-foreground">ชื่อพนักงาน</th>
                    <th className="pb-3 font-medium text-muted-foreground text-right">
                      แก้ไขสำเร็จ
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground text-right">
                      เวลาตอบเฉลี่ย (นาที)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.staffId} className="border-b last:border-b-0">
                      <td className="py-3 text-foreground">{s.staffName}</td>
                      <td className="py-3 text-right text-foreground">{s.resolvedCount}</td>
                      <td className="py-3 text-right text-foreground">{s.avgResponseMinutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </QueryBoundary>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">{icon}<span className="text-sm">{label}</span></div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

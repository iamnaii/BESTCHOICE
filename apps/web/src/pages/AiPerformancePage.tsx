import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Input } from '@/components/ui/input';
import { BarChart3, Bot, ThumbsUp, ArrowRightLeft, Database, TrendingUp } from 'lucide-react';

interface AiMetrics {
  autoReplyRate: number;
  acceptRate: number;
  handoffRate: number;
  trainingPairs: number;
  avgConfidence: number;
  totalAutoReplies?: number;
  totalSessions?: number;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

function StatCard({ icon, label, value, sub, color = 'text-foreground' }: StatCardProps) {
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AiPerformancePage() {
  const today = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const [from, setFrom] = useState(toDateInput(thirtyDaysAgo));
  const [to, setTo] = useState(toDateInput(today));

  const metricsQuery = useQuery<AiMetrics>({
    queryKey: ['ai-metrics', from, to],
    queryFn: () =>
      api
        .get('/staff-chat/ai/metrics', { params: { from, to } })
        .then((r: any) => r.data),
    enabled: !!from && !!to,
  });

  const data = metricsQuery.data;

  return (
    <div>
      <PageHeader title="AI Performance" subtitle="ประสิทธิภาพและสถิติการตอบแชทด้วย AI" />

      {/* Date filter */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">จาก</label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-auto"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">ถึง</label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-auto"
          />
        </div>
      </div>

      {/* Metrics */}
      <QueryBoundary
        isLoading={metricsQuery.isLoading}
        isError={metricsQuery.isError}
        error={metricsQuery.error}
        onRetry={() => metricsQuery.refetch()}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            icon={<Bot className="w-4 h-4 text-purple-500" />}
            label="Auto-Reply Rate"
            value={data ? `${data.autoReplyRate.toFixed(1)}%` : '—'}
            sub="% ของแชทที่ AI ตอบได้"
            color="text-purple-700"
          />
          <StatCard
            icon={<ThumbsUp className="w-4 h-4 text-green-500" />}
            label="Accept Rate"
            value={data ? `${data.acceptRate.toFixed(1)}%` : '—'}
            sub="ลูกค้ายอมรับคำตอบ AI"
            color="text-green-700"
          />
          <StatCard
            icon={<ArrowRightLeft className="w-4 h-4 text-orange-500" />}
            label="Handoff Rate"
            value={data ? `${data.handoffRate.toFixed(1)}%` : '—'}
            sub="โอนให้พนักงาน"
            color="text-orange-700"
          />
          <StatCard
            icon={<Database className="w-4 h-4 text-blue-500" />}
            label="Training Pairs"
            value={data ? (data.trainingPairs ?? 0).toLocaleString() : '—'}
            sub="คู่ข้อมูล training"
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4 text-indigo-500" />}
            label="Avg Confidence"
            value={data ? `${(data.avgConfidence * 100).toFixed(1)}%` : '—'}
            sub="ความมั่นใจเฉลี่ย"
            color="text-indigo-700"
          />
        </div>

        {/* Extra summary row if available */}
        {data && (data.totalAutoReplies !== undefined || data.totalSessions !== undefined) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            {data.totalSessions !== undefined && (
              <StatCard
                icon={<BarChart3 className="w-4 h-4 text-muted-foreground" />}
                label="Sessions ทั้งหมด"
                value={data.totalSessions.toLocaleString()}
              />
            )}
            {data.totalAutoReplies !== undefined && (
              <StatCard
                icon={<Bot className="w-4 h-4 text-muted-foreground" />}
                label="AI ตอบทั้งหมด"
                value={data.totalAutoReplies.toLocaleString()}
                sub="ครั้ง"
              />
            )}
          </div>
        )}

        {!data && !metricsQuery.isLoading && (
          <div className="mt-8 text-center py-12 text-muted-foreground">
            <BarChart3 className="w-10 h-10 mx-auto mb-2" />
            <p>ยังไม่มีข้อมูลในช่วงเวลาที่เลือก</p>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

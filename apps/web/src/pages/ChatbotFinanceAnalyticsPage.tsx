import { formatNumericText } from '@/utils/numericText';
import { toBangkokDateString } from '@/lib/date';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Link } from 'react-router';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import DateRangeField from '@/components/ui/DateRangeField';
import EmptyState from '@/components/ui/EmptyState';

interface AnalyticsOverview {
  today: {
    sessions: number;
    messages: number;
    handoffs: number;
    autoTriggers: number;
    totalCostUsd: number;
  };
  total: {
    sessions: number;
    verifiedCustomers: number;
    activeHandoffs: number;
    knowledgeEntries: number;
  };
  topIntents: { intent: string; count: number }[];
  recentDays: { date: string; messages: number }[];
}

interface DateRangeStats {
  dailyStats: { date: string; messages: number; cost: number }[];
  totalCost: number;
  totalMessages: number;
  handoffs: number;
}

function StatCard({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: 'blue' | 'orange' | 'green' | 'red' }) {
  const colors = {
    blue: 'border-info/20 bg-info/10',
    orange: 'border-warning/20 bg-warning/10',
    green: 'border-success/20 bg-success/10',
    red: 'border-destructive/20 bg-destructive/10',
  };
  const cls = colors[accent ?? 'blue'];
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export default function ChatbotFinanceAnalyticsPage() {
  const thirtyDaysAgo = toBangkokDateString(new Date(Date.now() - 30 * 86400_000));
  const todayStr = toBangkokDateString();
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(todayStr);

  const { data, isLoading, isError, error, refetch } = useQuery<AnalyticsOverview>({
    queryKey: ['chatbot-finance-analytics'],
    queryFn: async () => {
      const { data } = await api.get<AnalyticsOverview>('/chatbot/finance/admin/analytics');
      return data;
    },
    refetchInterval: 30_000,
  });

  const dateRange = useQuery<DateRangeStats>({
    queryKey: ['chatbot-finance-date-range', startDate, endDate],
    queryFn: async () => {
      const { data } = await api.get<DateRangeStats>('/chatbot/finance/admin/analytics/date-range', {
        params: { startDate, endDate },
      });
      return data;
    },
  });

  if (isLoading || isError) {
    return (
      <div>
        <PageHeader title="สถิติผู้ช่วยแชทการเงิน" subtitle="สถิติการใช้งานและบทสนทนา" />
        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดสถิติได้"
        >
          {null}
        </QueryBoundary>
      </div>
    );
  }
  if (!data) return <EmptyState title="ยังไม่มีข้อมูลสถิติ" actionLabel="ลองใหม่" onAction={() => void refetch()} />;

  const maxMessages = Math.max(...data.recentDays.map((d) => d.messages), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="สถิติผู้ช่วยแชทการเงิน"
        subtitle="สถิติการใช้งานและบทสนทนา"
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/chatbot-finance/sessions"
              className="px-4 py-2 rounded-lg border border-border text-foreground text-sm hover:bg-accent"
            >
              ดูบทสนทนา
            </Link>
            <Link
              to="/chatbot-finance/knowledge"
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 font-medium"
            >
              จัดการ คลังความรู้
            </Link>
            <Link
              to="/chatbot-finance/learning"
              className="px-4 py-2 rounded-lg border border-border text-foreground text-sm hover:bg-accent"
            >
              ศูนย์เรียนรู้
            </Link>
          </div>
        }
      />

      {/* Today */}
      <section>
        <h2 className="text-sm font-semibold text-foreground/80 mb-2">วันนี้</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="บทสนทนา ใหม่" value={data.today.sessions} accent="blue" />
          <StatCard label="ข้อความรวม" value={data.today.messages} accent="blue" />
          <StatCard label="ส่งต่อพนักงาน" value={data.today.handoffs} accent="orange" />
          <StatCard label="Auto-trigger" value={data.today.autoTriggers} accent="green" />
          <StatCard
            label="ค่าใช้บริการ API"
            value={`$${formatNumericText(data.today.totalCostUsd.toFixed(4))}`}
            hint="ประมาณ"
            accent="blue"
          />
        </div>
      </section>

      {/* Total */}
      <section>
        <h2 className="text-sm font-semibold text-foreground/80 mb-2">รวมทั้งหมด</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="บทสนทนา ทั้งหมด" value={data.total.sessions} />
          <StatCard label="ลูกค้า Verified" value={data.total.verifiedCustomers} accent="green" />
          <StatCard
            label="งานที่ส่งต่อพนักงาน"
            value={data.total.activeHandoffs}
            accent={data.total.activeHandoffs > 0 ? 'red' : 'green'}
          />
          <StatCard label="รายการความรู้" value={data.total.knowledgeEntries} />
        </div>
      </section>

      {/* Recent days chart (simple bars) */}
      <section className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-foreground/80 mb-3">ข้อความ 7 วันย้อนหลัง</h2>
        <div className="space-y-2">
          {data.recentDays.length === 0 ? (
            <EmptyState title="ยังไม่มีข้อมูลในช่วงนี้" description="ข้อมูลจะแสดงเมื่อมีบทสนทนาในช่วงเวลาที่เลือก" className="py-6" />
          ) : (
            data.recentDays.map((d) => (
              <div key={d.date} className="flex items-center gap-3">
                <div className="w-24 text-xs text-muted-foreground">{d.date}</div>
                <div className="flex-1 h-6 bg-muted rounded relative overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${(d.messages / maxMessages) * 100}%` }}
                  />
                </div>
                <div className="w-12 text-right text-xs text-foreground/80">{d.messages}</div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Top intents */}
      <section className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-foreground/80 mb-3">Top Intents (7 วัน)</h2>
        {data.topIntents.length === 0 ? (
          <EmptyState title="ยังไม่มีข้อมูลในช่วงนี้" description="ข้อมูลจะแสดงเมื่อมีบทสนทนาในช่วงเวลาที่เลือก" className="py-6" />
        ) : (
          <div className="space-y-2">
            {data.topIntents.map((i) => (
              <div key={i.intent} className="flex justify-between text-sm">
                <span className="text-foreground/80">{i.intent}</span>
                <span className="font-semibold text-foreground">{i.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Date range analytics + cost */}
      <section className="bg-card border border-border rounded-xl p-4">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <h2 className="text-sm font-semibold text-foreground/80">ข้อความ + Cost ตามช่วงเวลา</h2>
          <DateRangeField from={startDate} to={endDate} onFromChange={setStartDate} onToChange={setEndDate} className="w-full sm:w-auto" />
        </div>

        <QueryBoundary
          isLoading={dateRange.isLoading && !dateRange.data}
          isError={dateRange.isError}
          error={dateRange.error}
          onRetry={dateRange.refetch}
          errorTitle="ไม่สามารถโหลดข้อมูลได้"
        >
          {dateRange.data && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <StatCard label="ข้อความรวม" value={dateRange.data.totalMessages} accent="blue" />
                <StatCard label="API Cost รวม" value={`$${formatNumericText(dateRange.data.totalCost.toFixed(4))}`} accent="orange" />
                <StatCard label="ส่งต่อพนักงาน" value={dateRange.data.handoffs} accent="red" />
              </div>

              <div className="space-y-1">
                {dateRange.data.dailyStats.length === 0 ? (
                  <EmptyState title="ไม่พบข้อมูลในช่วงวันที่เลือก" description="เปลี่ยนช่วงวันที่เพื่อตรวจสอบข้อมูลช่วงอื่น" actionLabel="ดู 30 วันล่าสุด" onAction={() => { setStartDate(thirtyDaysAgo); setEndDate(todayStr); }} className="py-6" />
                ) : (
                  dateRange.data.dailyStats.map((d) => {
                    const maxMsg = Math.max(...dateRange.data!.dailyStats.map((x) => x.messages), 1);
                    return (
                      <div key={d.date} className="flex items-center gap-3">
                        <div className="w-20 text-[10px] text-muted-foreground">{d.date}</div>
                        <div className="flex-1 h-5 bg-muted rounded relative overflow-hidden">
                          <div
                            className="h-full bg-primary/70"
                            style={{ width: `${(d.messages / maxMsg) * 100}%` }}
                          />
                        </div>
                        <div className="w-10 text-right text-[10px] text-foreground/80">{d.messages}</div>
                        <div className="w-16 text-right text-[10px] text-muted-foreground">
                          ${formatNumericText(d.cost.toFixed(4))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </QueryBoundary>
      </section>
    </div>
  );
}

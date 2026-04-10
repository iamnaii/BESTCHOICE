import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Link } from 'react-router-dom';
import QueryBoundary from '@/components/QueryBoundary';

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
    blue: 'border-blue-200 bg-blue-50',
    orange: 'border-orange-200 bg-orange-50',
    green: 'border-green-200 bg-green-50',
    red: 'border-red-200 bg-red-50',
  };
  const cls = colors[accent ?? 'blue'];
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function ChatbotFinanceAnalyticsPage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
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
      <div className="p-6">
        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลด Analytics ได้"
        >
          {null}
        </QueryBoundary>
      </div>
    );
  }
  if (!data) return null;

  const maxMessages = Math.max(...data.recentDays.map((d) => d.messages), 1);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">น้องเบส — Finance Bot Analytics</h1>
        <div className="flex gap-2">
          <Link
            to="/chatbot-finance/sessions"
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
          >
            ดูบทสนทนา
          </Link>
          <Link
            to="/chatbot-finance/knowledge"
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            จัดการ Knowledge Base
          </Link>
          <Link
            to="/chatbot-finance/learning"
            className="px-4 py-2 rounded-lg border border-purple-300 text-purple-600 text-sm hover:bg-purple-50"
          >
            Learning Hub
          </Link>
        </div>
      </div>

      {/* Today */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">วันนี้</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Sessions ใหม่" value={data.today.sessions} accent="blue" />
          <StatCard label="ข้อความรวม" value={data.today.messages} accent="blue" />
          <StatCard label="Handoff" value={data.today.handoffs} accent="orange" />
          <StatCard label="Auto-trigger" value={data.today.autoTriggers} accent="green" />
          <StatCard
            label="API Cost"
            value={`$${data.today.totalCostUsd.toFixed(4)}`}
            hint="ประมาณ"
            accent="blue"
          />
        </div>
      </section>

      {/* Total */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">รวมทั้งหมด</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Sessions ทั้งหมด" value={data.total.sessions} />
          <StatCard label="ลูกค้า Verified" value={data.total.verifiedCustomers} accent="green" />
          <StatCard
            label="Active Handoff"
            value={data.total.activeHandoffs}
            accent={data.total.activeHandoffs > 0 ? 'red' : 'green'}
          />
          <StatCard label="Knowledge Entries" value={data.total.knowledgeEntries} />
        </div>
      </section>

      {/* Recent days chart (simple bars) */}
      <section className="bg-white border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">ข้อความ 7 วันย้อนหลัง</h2>
        <div className="space-y-2">
          {data.recentDays.length === 0 ? (
            <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>
          ) : (
            data.recentDays.map((d) => (
              <div key={d.date} className="flex items-center gap-3">
                <div className="w-24 text-xs text-gray-500">{d.date}</div>
                <div className="flex-1 h-6 bg-gray-100 rounded relative overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${(d.messages / maxMessages) * 100}%` }}
                  />
                </div>
                <div className="w-12 text-right text-xs text-gray-700">{d.messages}</div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Top intents */}
      <section className="bg-white border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Top Intents (7 วัน)</h2>
        {data.topIntents.length === 0 ? (
          <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>
        ) : (
          <div className="space-y-2">
            {data.topIntents.map((i) => (
              <div key={i.intent} className="flex justify-between text-sm">
                <span className="text-gray-700">{i.intent}</span>
                <span className="font-semibold text-gray-900">{i.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Date range analytics + cost */}
      <section className="bg-white border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">ข้อความ + Cost ตามช่วงเวลา</h2>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 border rounded text-xs"
            />
            <span className="text-xs text-gray-400">ถึง</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 border rounded text-xs"
            />
          </div>
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
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatCard label="ข้อความรวม" value={dateRange.data.totalMessages} accent="blue" />
                <StatCard label="API Cost รวม" value={`$${dateRange.data.totalCost.toFixed(4)}`} accent="orange" />
                <StatCard label="Handoff" value={dateRange.data.handoffs} accent="red" />
              </div>

              <div className="space-y-1">
                {dateRange.data.dailyStats.length === 0 ? (
                  <p className="text-sm text-gray-400">ไม่มีข้อมูลในช่วงนี้</p>
                ) : (
                  dateRange.data.dailyStats.map((d) => {
                    const maxMsg = Math.max(...dateRange.data!.dailyStats.map((x) => x.messages), 1);
                    return (
                      <div key={d.date} className="flex items-center gap-3">
                        <div className="w-20 text-[10px] text-gray-500">{d.date}</div>
                        <div className="flex-1 h-5 bg-gray-100 rounded relative overflow-hidden">
                          <div
                            className="h-full bg-blue-400"
                            style={{ width: `${(d.messages / maxMsg) * 100}%` }}
                          />
                        </div>
                        <div className="w-10 text-right text-[10px] text-gray-700">{d.messages}</div>
                        <div className="w-16 text-right text-[10px] text-gray-400">
                          ${d.cost.toFixed(4)}
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

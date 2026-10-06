import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { BarChart3, RefreshCw, Settings } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ChatAnalyticsOverview,
  ChatAnalyticsWork,
  ChatAnalyticsSales,
  ChatAnalyticsFunnel,
  ChatAnalyticsPage as Page,
  ChatStaffMetrics,
  ChatAnalyticsPeriod,
  ChatWorkMetric,
  ChatCycleMetric,
} from '@installment/shared';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { useChatWorkSettings } from './UnifiedInboxPage/hooks/useChatWork';
import ResponseMetrics from './chat-analytics/ResponseMetrics';
import StaffPerformanceTable from './chat-analytics/StaffPerformanceTable';
import AnalyticsCoverage from './chat-analytics/AnalyticsCoverage';
import ChatSalesFunnel from './chat-analytics/ChatSalesFunnel';
import MetricButton from './chat-analytics/MetricButton';
import AnalyticsDrilldown, { type Drill } from './chat-analytics/AnalyticsDrilldown';
import ChatWorkSettingsDialog from './chat-analytics/ChatWorkSettingsDialog';
import {
  bangkokPeriod,
  analyticsDate,
  formatMetric,
  csvCell,
} from './chat-analytics/analytics-format';
const field =
  'mt-1 min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const monthAgo = () =>
  new Date(Date.now() + 7 * 3600000 - 29 * 86400000).toISOString().slice(0, 10);
export default function ChatAnalyticsPage() {
  const work = useChatWorkSettings(),
    { user } = useAuth(),
    [settings, setSettings] = useState(false);
  return (
    <div className="min-w-0 pb-8">
      <PageHeader
        title="ภาพรวมงานแชท"
        subtitle={`งาน${work.company === 'SHOP' ? 'หน้าร้าน · SHOP' : 'การเงิน · FINANCE'} · หลักฐานการตอบ งานทีม และการขาย`}
        icon={<BarChart3 className="size-5" />}
        action={
          <>
            {user?.role === 'OWNER' && (
              <Button variant="outline" onClick={() => setSettings(true)}>
                <Settings className="size-4" />
                ตั้งค่างานแชท
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to={`/inbox?zone=${work.company === 'SHOP' ? 'shop' : 'fin'}`}>กลับแชท</Link>
            </Button>
          </>
        }
      />
      <QueryBoundary
        isLoading={work.settings.isLoading}
        isError={work.settings.isError}
        error={work.settings.error}
        onRetry={() => work.settings.refetch()}
      >
        {work.settings.data?.flags.chat_analytics_v2_enabled ? (
          <AnalyticsDashboard key={work.key.join(':')} />
        ) : (
          <p className="rounded-xl border bg-card p-6 text-muted-foreground">
            ยังไม่เปิดรายงานงานแชท
          </p>
        )}
      </QueryBoundary>
      {settings && <ChatWorkSettingsDialog onClose={() => setSettings(false)} />}
    </div>
  );
}
function AnalyticsDashboard() {
  const work = useChatWorkSettings(),
    [search, setSearch] = useSearchParams();
  const validDate = (value: string | null, fallback: () => string) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value).getTime())
      ? value
      : fallback();
  const start = validDate(search.get('start'), monthAgo),
    end = validDate(search.get('end'), today);
  const filters = {
    start,
    end,
    branchId: search.get('branchId') ?? '',
    staffId: search.get('staffId') ?? '',
    channel: search.get('channel') ?? '',
  };
  const [draft, setDraft] = useState(filters),
    [staffPage, setStaffPage] = useState(1),
    [drill, setDrill] = useState<Drill | null>(null),
    [exporting, setExporting] = useState(false),
    [validation, setValidation] = useState('');
  const period = bangkokPeriod(start, end);
  const params: ChatAnalyticsPeriod = {
    ...work.scope,
    ...period,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.staffId ? { staffId: filters.staffId } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
  };
  const key = ['chat-analytics-v2', ...work.key, params];
  const get = <T,>(endpoint: string, extra: Record<string, unknown> = {}) =>
    api
      .get<T>(`/chat-analytics/v2/${endpoint}`, { params: { ...params, ...extra } })
      .then((r) => r.data);
  const overview = useQuery({
    queryKey: [...key, 'overview'],
    queryFn: () => get<ChatAnalyticsOverview>('overview'),
    retry: false,
  });
  const workQ = useQuery({
    queryKey: [...key, 'work'],
    queryFn: () => get<ChatAnalyticsWork>('work'),
    retry: false,
  });
  const staff = useQuery({
    queryKey: [...key, 'staff', staffPage],
    queryFn: () => get<Page<ChatStaffMetrics>>('staff', { page: staffPage, limit: 10 }),
    retry: false,
  });
  const sales = useQuery({
    queryKey: [...key, 'sales'],
    queryFn: () => get<ChatAnalyticsSales>('sales', { limit: 1 }),
    retry: false,
  });
  const funnel = useQuery({
    queryKey: [...key, 'funnel'],
    queryFn: () => get<ChatAnalyticsFunnel>('funnel'),
    retry: false,
  });
  const options = useQuery({
    queryKey: [...key, 'options'],
    queryFn: () =>
      get<{ branches: { id: string; name: string }[]; staff: { id: string; name: string }[] }>(
        'filter-options',
      ),
    retry: false,
  });
  const queries = [overview, workQ, staff, sales, funnel, options];
  const refresh = () => queries.forEach((q) => void q.refetch());
  const cycle = (metric: ChatCycleMetric, title: string, extra: Record<string, string> = {}) =>
    setDrill({ endpoint: 'cycles', title, filters: { metric, ...extra } });
  const exportSales = async () => {
    setExporting(true);
    try {
      const result = await get<ChatAnalyticsSales>('sales/export');
      const rows = [
        [
          'เอกสาร',
          'ประเภท',
          'ลูกค้า',
          'เจ้าของยอด',
          'จำนวนเงิน',
          'วันที่',
          'หลักฐานทักก่อนขาย',
          'ฐานยอด',
        ],
        ...result.data.map((r) => [
          r.number,
          r.type,
          r.customerName,
          r.salespersonName,
          r.amount,
          r.createdAt,
          r.firstInboundAt,
          result.basis,
        ]),
      ];
      const url = URL.createObjectURL(
        new Blob(['\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], {
          type: 'text/csv;charset=utf-8',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `chat-linked-${work.company}-${start}-${end}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`ส่งออก ${result.total} รายการแล้ว`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="min-w-0 space-y-6">
      <form
        className="grid min-w-0 grid-cols-1 items-end gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            draft.end < draft.start ||
            new Date(draft.end).getTime() - new Date(draft.start).getTime() > 365 * 86400000
          ) {
            setValidation('เลือกช่วงวันที่เรียงลำดับ ไม่เกิน 366 วัน');
            return;
          }
          setValidation('');
          const next = new URLSearchParams(search);
          Object.entries(draft).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
          setSearch(next);
          setStaffPage(1);
          setDrill(null);
        }}
      >
        <label className="min-w-0 text-sm">
          ตั้งแต่
          <input
            className={field}
            type="date"
            required
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </label>
        <label className="min-w-0 text-sm">
          ถึงวันที่
          <input
            className={field}
            type="date"
            required
            value={draft.end}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          />
        </label>
        <label className="min-w-0 text-sm">
          สาขา
          <select
            className={field}
            value={draft.branchId}
            onChange={(e) => setDraft({ ...draft, branchId: e.target.value, staffId: '' })}
          >
            <option value="">สาขาที่มีสิทธิ์</option>
            {options.data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          ช่องทาง
          <select
            className={field}
            value={draft.channel}
            onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
          >
            <option value="">ทุกช่องทางในบริษัท</option>
            {(work.company === 'SHOP'
              ? ['FACEBOOK', 'LINE_SHOP', 'TIKTOK', 'WEB']
              : ['LINE_FINANCE']
            ).map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          พนักงาน
          <select
            className={field}
            value={draft.staffId}
            onChange={(e) => setDraft({ ...draft, staffId: e.target.value })}
          >
            <option value="">ทุกคน</option>
            {options.data?.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.id.slice(-6)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" className="min-h-11">
          แสดงรายงาน
        </Button>
        {validation && (
          <p role="alert" className="text-sm text-destructive sm:col-span-2 xl:col-span-6">
            {validation}
          </p>
        )}
      </form>
      <QueryBoundary
        isLoading={queries.some((q) => q.isLoading)}
        isError={queries.some((q) => q.isError)}
        error={queries.find((q) => q.isError)?.error}
        onRetry={refresh}
      >
        {overview.data && workQ.data && staff.data && sales.data && funnel.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <p>เวลาไทย · อ่านล่าสุด {analyticsDate(overview.data.observedAt)}</p>
              <Button
                variant="outline"
                onClick={refresh}
                disabled={queries.some((q) => q.isFetching)}
              >
                <RefreshCw className="size-4" />
                อัปเดตข้อมูล
              </Button>
            </div>
            <section className="space-y-3">
              <div>
                <h2 className="font-semibold">งานค้างตอนนี้</h2>
                <p className="text-sm text-muted-foreground">
                  ยอดปัจจุบัน ไม่เปลี่ยนตามช่วงวันที่ · เคสบริการหนึ่งเรื่องนับเป็นงานเดียว
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(
                  [
                    ['รวมรายการค้าง', overview.data.openWorkNow.totalItems, 'ALL'],
                    ['ห้องรอคนตอบ', overview.data.openWorkNow.roomWaits, 'ROOM'],
                    ['งานที่ยังไม่จบ', overview.data.openWorkNow.activeTasks, 'TASK'],
                    ['คอมเมนต์รอตอบ', overview.data.openWorkNow.comments, 'COMMENT'],
                  ] as const
                ).map(([label, value, metric]) => (
                  <MetricButton
                    key={metric}
                    label={label}
                    value={value}
                    unit="รายการ"
                    onClick={() =>
                      setDrill({ endpoint: 'open-work', title: label, filters: { metric } })
                    }
                  />
                ))}
              </div>
            </section>
            <ResponseMetrics data={overview.data.responses} onDrill={cycle} />
            <section className="space-y-3">
              <h2 className="font-semibold">งานทีมและการส่งต่อ</h2>
              <WorkMetrics
                data={workQ.data}
                onDrill={(metric, title) =>
                  setDrill({ endpoint: 'work-details', title, filters: { metric } })
                }
              />
              <StaffPerformanceTable
                data={staff.data.data}
                total={staff.data.total}
                page={staffPage}
                onPage={setStaffPage}
                onStaff={(row) =>
                  cycle(
                    row.staffId ? 'RESPONDED' : 'UNKNOWN',
                    `คำตอบของ ${row.name}`,
                    row.staffId ? { staffId: row.staffId } : {},
                  )
                }
              />
            </section>
            <ChatSalesFunnel
              funnel={funnel.data}
              sales={sales.data}
              onFunnel={(stage, state, title) =>
                setDrill({ endpoint: 'funnel-details', title, filters: { stage, state } })
              }
              onSales={() => setDrill({ endpoint: 'sales', title: 'เอกสารขายที่เชื่อมโยงกับแชท' })}
              onExport={exportSales}
              exporting={exporting}
            />
            <AnalyticsCoverage data={overview.data} />
          </>
        )}
      </QueryBoundary>
      {drill && (
        <AnalyticsDrilldown
          key={JSON.stringify(drill) + JSON.stringify(params)}
          drill={drill}
          params={params}
          scopeKey={key}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}
function WorkMetrics({
  data,
  onDrill,
}: {
  data: ChatAnalyticsWork;
  onDrill: (metric: ChatWorkMetric, title: string) => void;
}) {
  const groups: Array<{ title: string; items: Array<[string, number | null, ChatWorkMetric]> }> = [
    {
      title: 'ส่งงาน',
      items: [
        ['สร้าง', data.handoffs.created, 'HANDOFF_CREATED'],
        ['รับแล้ว', data.handoffs.accepted, 'HANDOFF_ACCEPTED'],
        ['จบ', data.handoffs.completed, 'HANDOFF_COMPLETED'],
        ['เลยกำหนดตอนนี้', data.handoffs.overdueNow, 'HANDOFF_OVERDUE'],
      ],
    },
    {
      title: 'นัดติดตาม',
      items: [
        ['เคยมีกำหนดในช่วง', data.followUps.due, 'FOLLOW_UP_DUE'],
        ['จบในช่วง', data.followUps.completed, 'FOLLOW_UP_COMPLETED'],
        ['เลยกำหนดตอนนี้', data.followUps.overdueNow, 'FOLLOW_UP_OVERDUE'],
      ],
    },
    {
      title: 'คอมเมนต์',
      items: [
        ['รับเข้า', data.comments.received, 'COMMENT_RECEIVED'],
        ['คำตอบยืนยันแล้ว', data.comments.confirmedReplies, 'COMMENT_CONFIRMED'],
        ['ค้างตอนนี้', data.comments.unresolvedNow, 'COMMENT_UNRESOLVED'],
      ],
    },
    {
      title: 'หลังการขาย',
      items: [
        ['รับเรื่อง', data.serviceRequests.created, 'SERVICE_CREATED'],
        ['เชื่อมเคส', data.serviceRequests.linkedToCase, 'SERVICE_LINKED'],
        ['จบ', data.serviceRequests.resolved, 'SERVICE_RESOLVED'],
        ['เลยกำหนดตอนนี้', data.serviceRequests.overdueNow, 'SERVICE_OVERDUE'],
      ],
    },
  ];
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="min-w-0">
            <h3 className="text-sm font-medium">{g.title}</h3>
            <div className="mt-2 divide-y">
              {g.items.map(([label, value, metric]) => (
                <button
                  key={metric}
                  type="button"
                  disabled={value === null}
                  onClick={() => onDrill(metric, `${g.title} · ${label}`)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground"
                >
                  <span>{label}</span>
                  <b className="text-right tabular-nums">{formatMetric(value, '')}</b>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <details className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">วิธีนับงานและตัวกรองพนักงาน</summary>
        {data.filterNotes.map((note) => (
          <p key={note} className="mt-2 leading-relaxed">
            {note}
          </p>
        ))}
        <p className="mt-2">
          เคสที่จบแต่ไม่ทราบเวลาปิด {data.unknownCaseClosureTimes} เรื่อง
          (ไม่ใส่ย้อนหลังลงช่วงวันที่)
        </p>
      </details>
    </div>
  );
}

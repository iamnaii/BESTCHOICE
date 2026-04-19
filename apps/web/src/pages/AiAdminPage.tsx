import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  DollarSign,
  FlaskConical,
  GraduationCap,
  Settings as SettingsIcon,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface SummaryBudget {
  dailyUsd: number;
  todayUsd: number;
  percentUsed: number;
  breached: boolean;
  alertThreshold: number;
}

interface SummaryToday {
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  errorCount: number;
  errorRate: number;
}

interface SummaryResponse {
  budget: SummaryBudget;
  today: SummaryToday;
  sevenDays: { calls: number; costUsd: number };
  thirtyDays: { calls: number; costUsd: number };
  todayByService: Array<{ service: string; calls: number; costUsd: number }>;
}

interface BreakdownRow {
  key: string;
  calls: number;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface TrendPoint {
  date: string;
  costUsd: number;
  calls: number;
}

interface LogRow {
  id: string;
  service: string;
  method: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  userId: string | null;
  status: string;
  errorKind: string | null;
  createdAt: string;
}

interface LogsResponse {
  data: LogRow[];
  total: number;
  page: number;
  limit: number;
}

function formatUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warning' | 'error' | 'success';
}

function StatCard({ icon, label, value, sub, tone = 'default' }: StatCardProps) {
  const toneMap = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-destructive',
  } as const;
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${toneMap[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export default function AiAdminPage() {
  const [groupBy, setGroupBy] = useState<'service' | 'model' | 'user'>('service');
  const [trendDays, setTrendDays] = useState(30);
  const [logsPage, setLogsPage] = useState(1);
  const [logStatus, setLogStatus] = useState<'all' | 'success' | 'error'>('all');

  const summaryQuery = useQuery<SummaryResponse>({
    queryKey: ['ai-usage-summary'],
    queryFn: () => api.get('/ai-usage/summary').then((r: any) => r.data),
    refetchInterval: 60_000,
  });

  const breakdownQuery = useQuery<BreakdownRow[]>({
    queryKey: ['ai-usage-breakdown', groupBy],
    queryFn: () =>
      api.get('/ai-usage/breakdown', { params: { groupBy } }).then((r: any) => r.data),
  });

  const trendQuery = useQuery<TrendPoint[]>({
    queryKey: ['ai-usage-trend', trendDays],
    queryFn: () =>
      api.get('/ai-usage/trend', { params: { days: trendDays } }).then((r: any) => r.data),
  });

  const logsQuery = useQuery<LogsResponse>({
    queryKey: ['ai-usage-logs', logsPage, logStatus],
    queryFn: () =>
      api
        .get('/ai-usage/logs', {
          params: {
            page: logsPage,
            limit: 25,
            ...(logStatus !== 'all' ? { status: logStatus } : {}),
          },
        })
        .then((r: any) => r.data),
  });

  const summary = summaryQuery.data;
  const budgetTone: StatCardProps['tone'] = summary?.budget.breached
    ? 'error'
    : summary && summary.budget.percentUsed >= 80
      ? 'warning'
      : 'success';

  const totalPages = useMemo(
    () => (logsQuery.data ? Math.max(1, Math.ceil(logsQuery.data.total / logsQuery.data.limit)) : 1),
    [logsQuery.data],
  );

  return (
    <div>
      <PageHeader
        title="AI Admin"
        subtitle="ตรวจสอบต้นทุน การใช้งาน และประสิทธิภาพของ Claude API"
      />

      {/* Shortcut tiles to other AI pages */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Link
          to="/settings/ai-performance"
          className="bg-card rounded-xl p-4 shadow-sm hover:bg-accent/50 transition-colors flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-primary" />
            <div>
              <p className="font-semibold text-foreground">AI Performance</p>
              <p className="text-xs text-muted-foreground">Auto-reply / accept / handoff</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </Link>
        <Link
          to="/settings/ai-training"
          className="bg-card rounded-xl p-4 shadow-sm hover:bg-accent/50 transition-colors flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <GraduationCap className="w-5 h-5 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Training</p>
              <p className="text-xs text-muted-foreground">คู่ข้อมูล training</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </Link>
        <Link
          to="/settings/ai-chat"
          className="bg-card rounded-xl p-4 shadow-sm hover:bg-accent/50 transition-colors flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-5 h-5 text-primary" />
            <div>
              <p className="font-semibold text-foreground">AI Settings</p>
              <p className="text-xs text-muted-foreground">Prompt / tone / handoff rules</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </Link>
      </div>

      {/* Summary */}
      <QueryBoundary
        isLoading={summaryQuery.isLoading}
        isError={summaryQuery.isError}
        error={summaryQuery.error}
        onRetry={() => summaryQuery.refetch()}
      >
        {summary && (
          <>
            {summary.budget.breached && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 mb-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-destructive">งบประจำวันเกินเพดาน</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    วันนี้ใช้ {formatUsd(summary.budget.todayUsd)} จาก{' '}
                    {formatUsd(summary.budget.dailyUsd)} — Sentry ได้รับการแจ้งเตือนแล้ว
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <StatCard
                icon={<DollarSign className="w-4 h-4 text-muted-foreground" />}
                label="งบประจำวัน"
                value={formatUsd(summary.budget.dailyUsd)}
                sub={`ใช้ไป ${summary.budget.percentUsed.toFixed(0)}% (${formatUsd(summary.budget.todayUsd)})`}
                tone={budgetTone}
              />
              <StatCard
                icon={<Bot className="w-4 h-4 text-muted-foreground" />}
                label="เรียกใช้วันนี้"
                value={summary.today.calls.toLocaleString()}
                sub={`in ${formatTokens(summary.today.inputTokens)} · out ${formatTokens(summary.today.outputTokens)}`}
              />
              <StatCard
                icon={<AlertTriangle className="w-4 h-4 text-muted-foreground" />}
                label="Error วันนี้"
                value={summary.today.errorCount.toLocaleString()}
                sub={`${summary.today.errorRate.toFixed(1)}% error rate`}
                tone={summary.today.errorRate > 5 ? 'warning' : 'default'}
              />
              <StatCard
                icon={<Activity className="w-4 h-4 text-muted-foreground" />}
                label="30 วัน"
                value={formatUsd(summary.thirtyDays.costUsd)}
                sub={`${summary.thirtyDays.calls.toLocaleString()} calls · 7d ${formatUsd(summary.sevenDays.costUsd)}`}
              />
            </div>
          </>
        )}
      </QueryBoundary>

      {/* Trend chart */}
      <div className="bg-card rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">แนวโน้มค่าใช้จ่าย</h3>
          <Select value={String(trendDays)} onValueChange={(v) => setTrendDays(parseInt(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 วัน</SelectItem>
              <SelectItem value="14">14 วัน</SelectItem>
              <SelectItem value="30">30 วัน</SelectItem>
              <SelectItem value="60">60 วัน</SelectItem>
              <SelectItem value="90">90 วัน</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <QueryBoundary
          isLoading={trendQuery.isLoading}
          isError={trendQuery.isError}
          error={trendQuery.error}
          onRetry={() => trendQuery.refetch()}
        >
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={trendQuery.data ?? []}>
                <defs>
                  <linearGradient id="aiCostGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                <ChartTooltip
                  formatter={(v) => formatUsd(Number(v))}
                  labelFormatter={(d) => String(d)}
                />
                <Area
                  type="monotone"
                  dataKey="costUsd"
                  stroke="hsl(var(--primary))"
                  fill="url(#aiCostGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </QueryBoundary>
      </div>

      {/* Breakdown */}
      <div className="bg-card rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">แยกตาม</h3>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="service">Service</SelectItem>
              <SelectItem value="model">Model</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <QueryBoundary
          isLoading={breakdownQuery.isLoading}
          isError={breakdownQuery.isError}
          error={breakdownQuery.error}
          onRetry={() => breakdownQuery.refetch()}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{groupBy === 'user' ? 'ผู้ใช้' : groupBy === 'model' ? 'Model' : 'Service'}</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Input tokens</TableHead>
                <TableHead className="text-right">Output tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(breakdownQuery.data ?? []).map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{row.key}</TableCell>
                  <TableCell className="text-right">{row.calls.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {row.inputTokens !== undefined ? formatTokens(row.inputTokens) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.outputTokens !== undefined ? formatTokens(row.outputTokens) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatUsd(row.costUsd)}</TableCell>
                </TableRow>
              ))}
              {!breakdownQuery.isLoading && (breakdownQuery.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    ยังไม่มีข้อมูลในช่วงเวลานี้
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </QueryBoundary>
      </div>

      {/* Logs */}
      <div className="bg-card rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            Recent calls
          </h3>
          <Select
            value={logStatus}
            onValueChange={(v) => {
              setLogStatus(v as typeof logStatus);
              setLogsPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทั้งหมด</SelectItem>
              <SelectItem value="success">สำเร็จ</SelectItem>
              <SelectItem value="error">ล้มเหลว</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <QueryBoundary
          isLoading={logsQuery.isLoading}
          isError={logsQuery.isError}
          error={logsQuery.error}
          onRetry={() => logsQuery.refetch()}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(logsQuery.data?.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{row.service}</div>
                    {row.method && <div className="text-xs text-muted-foreground">{row.method}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.model}</TableCell>
                  <TableCell className="text-right text-xs">
                    {formatTokens(row.inputTokens)} / {formatTokens(row.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatUsd(row.costUsd)}</TableCell>
                  <TableCell>
                    {row.status === 'success' ? (
                      <Badge variant="outline" className="text-success border-success/30">
                        success
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-destructive border-destructive/30">
                        {row.errorKind ?? 'error'}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!logsQuery.isLoading && (logsQuery.data?.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    ยังไม่มีการเรียก AI ในช่วงเวลานี้
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {logsQuery.data && logsQuery.data.total > logsQuery.data.limit && (
            <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
              <span>
                หน้า {logsQuery.data.page} / {totalPages} · ทั้งหมด {logsQuery.data.total.toLocaleString()} รายการ
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logsPage <= 1}
                  onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                >
                  ก่อนหน้า
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logsPage >= totalPages}
                  onClick={() => setLogsPage((p) => p + 1)}
                >
                  ถัดไป
                </Button>
              </div>
            </div>
          )}
        </QueryBoundary>
      </div>
    </div>
  );
}

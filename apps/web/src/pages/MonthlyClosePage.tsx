import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Lock,
  RefreshCw,
  AlertTriangle,
  BookOpen,
  XCircle,
  Loader2,
  Calendar,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, accountingPeriodStatusMap } from '@/lib/status-badges';
import { Button } from '@/components/ui/button';
import { THAI_MONTHS_FULL } from '@/lib/date';
import { formatThaiDateShort } from '@/lib/date';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  nameTh: string;
  companyCode: string;
}

type PeriodStatus = 'OPEN' | 'REVIEW' | 'CLOSED' | 'SYNCED';

interface Period {
  year: number;
  month: number;
  status: PeriodStatus;
  companyId: string;
  closedAt?: string | null;
  closedBy?: { name: string } | null;
  peakSyncedAt?: string | null;
  peakSyncResult?: string | null;
  auditIssues?: string[] | null;
  reportSnapshot?: Record<string, unknown> | null;
}

// ─── Status Config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  PeriodStatus,
  { icon: React.ComponentType<{ className?: string }>; cardClass: string }
> = {
  OPEN: {
    icon: BookOpen,
    cardClass: 'border-border bg-card',
  },
  REVIEW: {
    icon: Clock,
    cardClass: 'border-warning/40 bg-warning/5',
  },
  CLOSED: {
    icon: Lock,
    cardClass: 'border-success/40 bg-success/5',
  },
  SYNCED: {
    icon: CheckCircle2,
    cardClass: 'border-primary/40 bg-primary/5',
  },
};

// ─── Month Card ───────────────────────────────────────────────────────────────

interface MonthCardProps {
  month: number; // 1-based
  period: Period | undefined;
  isSelected: boolean;
  onClick: () => void;
}

function MonthCard({ month, period, isSelected, onClick }: MonthCardProps) {
  const status: PeriodStatus = period?.status ?? 'OPEN';
  const cfg = STATUS_CONFIG[status];
  const StatusIcon = cfg.icon;
  const badgeCfg = getStatusBadgeProps(status, accountingPeriodStatusMap);
  const hasIssues = (period?.auditIssues?.length ?? 0) > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border-2 p-4 transition-all focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-hidden',
        cfg.cardClass,
        isSelected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
        'hover:brightness-105 cursor-pointer',
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">{THAI_MONTHS_FULL[month - 1]}</span>
        {hasIssues && (
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" aria-label="มีปัญหาที่ต้องแก้ไข" />
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Badge variant={badgeCfg.variant} appearance={badgeCfg.appearance} size="sm">
          <StatusIcon className="h-3 w-3 mr-1" />
          {badgeCfg.label}
        </Badge>
      </div>
    </button>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  period: Period | undefined;
  month: number;
  year: number;
  companyId: string;
  onActionSuccess: () => void;
}

function DetailPanel({ period, month, year, companyId, onActionSuccess }: DetailPanelProps) {
  const queryClient = useQueryClient();
  const status: PeriodStatus = period?.status ?? 'OPEN';
  const cfg = STATUS_CONFIG[status];
  const StatusIcon = cfg.icon;
  const badgeCfg = getStatusBadgeProps(status, accountingPeriodStatusMap);

  const mutationOptions = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthly-close-periods', companyId, year] });
      onActionSuccess();
    },
  };

  const startReviewMutation = useMutation({
    mutationFn: () =>
      api.post('/expenses/periods/start-review', { companyId, year, month }),
    onSuccess: () => {
      toast.success(`เริ่ม Review งวด ${THAI_MONTHS_FULL[month - 1]} ${year} แล้ว`);
      mutationOptions.onSuccess();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const closeMutation = useMutation({
    mutationFn: (notes?: string) =>
      api.post('/expenses/periods/close', { companyId, year, month, notes }),
    onSuccess: () => {
      toast.success(`ปิดงวด ${THAI_MONTHS_FULL[month - 1]} ${year} สำเร็จ`);
      mutationOptions.onSuccess();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const syncPeakMutation = useMutation({
    mutationFn: () =>
      api.post('/expenses/periods/sync-peak', { companyId, year, month }),
    onSuccess: () => {
      toast.success(`Sync ไป PEAK สำเร็จ`);
      mutationOptions.onSuccess();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const reopenMutation = useMutation({
    mutationFn: () =>
      api.post('/expenses/periods/reopen', { companyId, year, month }),
    onSuccess: () => {
      toast.success(`เปิดงวด ${THAI_MONTHS_FULL[month - 1]} ${year} ใหม่แล้ว`);
      mutationOptions.onSuccess();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const isBusy =
    startReviewMutation.isPending ||
    closeMutation.isPending ||
    syncPeakMutation.isPending ||
    reopenMutation.isPending;

  const auditIssues = period?.auditIssues ?? [];

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-base font-semibold">
            รายละเอียด — {THAI_MONTHS_FULL[month - 1]} {year}
          </h3>
          <Badge variant={badgeCfg.variant} appearance={badgeCfg.appearance}>
            <StatusIcon className="h-4 w-4 mr-1" />
            {badgeCfg.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Meta info */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {period?.closedAt && (
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-0.5">ปิดเมื่อ</p>
              <p className="text-sm font-medium">{formatThaiDateShort(period.closedAt)}</p>
            </div>
          )}
          {period?.closedBy && (
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-0.5">ปิดโดย</p>
              <p className="text-sm font-medium">{period.closedBy.name}</p>
            </div>
          )}
          {period?.peakSyncedAt && (
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-0.5">Sync PEAK เมื่อ</p>
              <p className="text-sm font-medium">{formatThaiDateShort(period.peakSyncedAt)}</p>
            </div>
          )}
        </div>

        {/* PEAK sync result */}
        {period?.peakSyncResult && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">ผลการ Sync PEAK</p>
            <p className="text-sm">{period.peakSyncResult}</p>
          </div>
        )}

        {/* Audit Issues */}
        {auditIssues.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1.5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <p className="text-sm font-semibold text-destructive">ปัญหาที่ต้องแก้ไข ({auditIssues.length})</p>
            </div>
            <ul className="space-y-1">
              {auditIssues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* No issues, no period → placeholder */}
        {!period && (
          <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลงวดนี้ — สถานะ เปิด โดย default</p>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 pt-1">
          {status === 'OPEN' && (
            <Button
              onClick={() => startReviewMutation.mutate()}
              disabled={isBusy}
              className="gap-2"
            >
              {startReviewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
              เริ่ม Review
            </Button>
          )}

          {status === 'REVIEW' && (
            <Button
              onClick={() => closeMutation.mutate(undefined)}
              disabled={isBusy}
              variant="primary"
              className="gap-2"
            >
              {closeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              ปิดงวด
            </Button>
          )}

          {status === 'CLOSED' && (
            <Button
              onClick={() => syncPeakMutation.mutate()}
              disabled={isBusy}
              variant="outline"
              className="gap-2"
            >
              {syncPeakMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync ไป PEAK
            </Button>
          )}

          {(status === 'REVIEW' || status === 'CLOSED') && (
            <Button
              onClick={() => reopenMutation.mutate()}
              disabled={isBusy}
              variant="outline"
              className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10"
            >
              {reopenMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookOpen className="h-4 w-4" />
              )}
              เปิดงวดใหม่
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MonthlyClosePage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(new Date().getMonth() + 1);
  const [companyId, setCompanyId] = useState<string>('');

  // Companies
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies')).data,
  });

  // Auto-select first company
  useEffect(() => {
    if (companies.length > 0 && !companyId) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  // Periods overview
  const periodsQuery = useQuery<Period[]>({
    queryKey: ['monthly-close-periods', companyId, year],
    queryFn: async () =>
      (await api.get('/expenses/periods/overview', { params: { companyId, year } })).data,
    enabled: !!companyId,
  });

  const periods = periodsQuery.data ?? [];

  const getPeriod = (month: number) =>
    periods.find((p) => p.month === month);

  const selectedPeriod = selectedMonth ? getPeriod(selectedMonth) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ปิดบัญชีรายเดือน"
        subtitle="จัดการสถานะงวดบัญชีและ Sync ไป PEAK"
        icon={<Calendar className="h-5 w-5" />}
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Company selector */}
        {companies.length > 0 && (
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              นิติบุคคล
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden min-w-[180px]"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameTh} ({c.companyCode})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Year selector */}
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            ปี (ค.ศ.)
          </label>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setYear((y) => y - 1)}
              aria-label="ปีก่อนหน้า"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="w-20 text-center font-semibold text-sm tabular-nums">
              {year} / {year + 543}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setYear((y) => y + 1)}
              aria-label="ปีถัดไป"
              disabled={year >= currentYear + 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 12-Month Grid */}
      <QueryBoundary
        isLoading={periodsQuery.isLoading && !!companyId}
        isError={periodsQuery.isError}
        error={periodsQuery.error}
        onRetry={periodsQuery.refetch}
      >
        {!companyId ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              กรุณาเลือกนิติบุคคลก่อน
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <MonthCard
                key={month}
                month={month}
                period={getPeriod(month)}
                isSelected={selectedMonth === month}
                onClick={() => setSelectedMonth(month === selectedMonth ? null : month)}
              />
            ))}
          </div>
        )}
      </QueryBoundary>

      {/* Detail Panel */}
      {selectedMonth && companyId && (
        <DetailPanel
          period={selectedPeriod}
          month={selectedMonth}
          year={year}
          companyId={companyId}
          onActionSuccess={() => {}}
        />
      )}
    </div>
  );
}

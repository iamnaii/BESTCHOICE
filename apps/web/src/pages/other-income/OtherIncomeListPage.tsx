import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, FileText, Receipt, RotateCcw, CheckCircle2, ChartBar, ClipboardCheck } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AccountingModuleTabBar } from '@/components/accounting/AccountingModuleTabBar';
import { ReopenedPeriodBanner } from '@/components/accounting/ReopenedPeriodBanner';
import { useDebounce } from '@/hooks/useDebounce';
import { usePaginationParams } from '@/hooks/usePaginationParams';
import { PaginationBar } from '@/components/ui/PaginationBar';
import { otherIncomeApi } from '@/lib/otherIncome';
import type { OtherIncome, OtherIncomeStatus } from '@/lib/otherIncome.types';
import { formatThaiDateShort } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';
import { DateRangeChips } from './components/DateRangeChips';

const STATUS_LABELS: Record<OtherIncomeStatus, string> = {
  DRAFT: 'ร่าง',
  READY: 'รออนุมัติ',
  POSTED: 'บันทึกแล้ว',
  REVERSED: 'กลับรายการ',
};

const STATUS_COLORS: Record<OtherIncomeStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  READY: 'bg-warning/10 text-warning',
  POSTED: 'bg-success/10 text-success',
  REVERSED: 'bg-destructive/10 text-destructive',
};

function StatusBadge({ status }: { status: OtherIncomeStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function fmt(v: string | number | undefined | null) {
  if (v === undefined || v === null) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return formatNumberDecimal(n, 2);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return formatThaiDateShort(d);
}

type StatusAccent = 'primary' | 'warning' | 'success' | 'muted';

const ACCENT_BAR: Record<StatusAccent, string> = {
  primary: 'bg-primary',
  warning: 'bg-warning',
  success: 'bg-success',
  muted: 'bg-muted-foreground/50',
};

const ACCENT_ICON: Record<StatusAccent, string> = {
  primary: 'bg-primary/10 text-primary',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  muted: 'bg-muted text-muted-foreground',
};

/** Filter keys for the 4 Status Cards (PDF v2.2 spec). */
type StatusFilter = 'ALL' | 'IN_PROGRESS' | 'POSTED' | 'REVERSED';

function StatusCard({
  label,
  sub,
  icon,
  accent,
  value,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  icon: React.ReactNode;
  accent: StatusAccent;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-xl border bg-card p-4 relative overflow-hidden transition-all hover:border-foreground/30 hover:bg-accent/30 ${
        active ? 'ring-2 ring-primary border-primary/40 bg-primary/5' : ''
      }`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${ACCENT_BAR[accent]}`} />
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{label}</p>
          <p className="text-[10px] font-medium text-muted-foreground tracking-wider mt-0.5">
            {sub}
          </p>
        </div>
        <div className={`size-9 rounded-full flex items-center justify-center shrink-0 ${ACCENT_ICON[accent]}`}>
          {icon}
        </div>
      </div>
      <p className="text-3xl font-bold font-mono text-foreground tabular-nums">{value}</p>
    </button>
  );
}

export default function OtherIncomeListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const { page, size, setPage, setSize } = usePaginationParams({ defaultSize: 50 });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteNumber, setConfirmDeleteNumber] = useState<string>('');

  const debouncedQ = useDebounce(q, 300);

  const flagQuery = useQuery({
    queryKey: ['other-income-maker-checker-enabled'],
    queryFn: () => otherIncomeApi.isMakerCheckerEnabled(),
    staleTime: 5 * 60_000,
  });
  const makerCheckerEnabled = flagQuery.data ?? false;

  // Map filter key → API params. IN_PROGRESS folds DRAFT+READY when MC is on,
  // falls back to DRAFT-only otherwise (READY status only exists with MC).
  const filterParams: { status?: OtherIncomeStatus; statusIn?: string } = (() => {
    if (statusFilter === 'ALL') return {};
    if (statusFilter === 'IN_PROGRESS') {
      return makerCheckerEnabled ? { statusIn: 'DRAFT,READY' } : { status: 'DRAFT' };
    }
    return { status: statusFilter };
  })();

  // PDF AC-5: sort oldest first for READY-heavy filters (IN_PROGRESS), newest first otherwise
  const sortDir = statusFilter === 'IN_PROGRESS' ? 'asc' : 'desc';

  const listQuery = useQuery({
    queryKey: ['other-income', 'list', { page, size, q: debouncedQ, statusFilter, makerCheckerEnabled, startDate, endDate }],
    queryFn: () =>
      otherIncomeApi.list({
        q: debouncedQ || undefined,
        ...filterParams,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        page,
        limit: size,
        sort: `createdAt:${sortDir}`,
      }),
  });

  const COUNT_STALE_TIME = 60_000;
  const allCountQuery = useQuery({
    queryKey: ['other-income', 'count', 'ALL'],
    queryFn: () => otherIncomeApi.list({ page: 1, limit: 1 }),
    select: (d) => d.total,
    staleTime: COUNT_STALE_TIME,
  });
  const inProgressCountQuery = useQuery({
    queryKey: ['other-income', 'count', 'IN_PROGRESS', makerCheckerEnabled],
    queryFn: () =>
      otherIncomeApi.list(
        makerCheckerEnabled
          ? { statusIn: 'DRAFT,READY', page: 1, limit: 1 }
          : { status: 'DRAFT', page: 1, limit: 1 },
      ),
    select: (d) => d.total,
    staleTime: COUNT_STALE_TIME,
  });
  const postedCountQuery = useQuery({
    queryKey: ['other-income', 'count', 'POSTED'],
    queryFn: () => otherIncomeApi.list({ status: 'POSTED', page: 1, limit: 1 }),
    select: (d) => d.total,
    staleTime: COUNT_STALE_TIME,
  });
  const reversedCountQuery = useQuery({
    queryKey: ['other-income', 'count', 'REVERSED'],
    queryFn: () => otherIncomeApi.list({ status: 'REVERSED', page: 1, limit: 1 }),
    select: (d) => d.total,
    staleTime: COUNT_STALE_TIME,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => otherIncomeApi.softDelete(id),
    onSuccess: () => {
      toast.success('ลบร่างเอกสารแล้ว');
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
    },
    onError: () => toast.error('ไม่สามารถลบเอกสารได้'),
  });

  const data = listQuery.data;
  const docs = data?.data ?? [];
  const total = data?.total ?? 0;

  const allCount = allCountQuery.data ?? 0;
  const inProgressCount = inProgressCountQuery.data ?? 0;
  const postedCount = postedCountQuery.data ?? 0;
  const reversedCount = reversedCountQuery.data ?? 0;

  const handleFilterClick = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setPage(1);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <AccountingModuleTabBar />
      <ReopenedPeriodBanner />
      <PageHeader
        title="รายได้อื่น"
        subtitle="จัดการเอกสารรับรู้รายได้อื่น (กลุ่ม 42-XXXX) — ดอกเบี้ยเงินฝาก, ค่าปรับ, รายได้หักค่าจ้าง ฯลฯ"
        icon={<Receipt size={20} />}
        action={
          <div className="flex items-center gap-2">
            <Link
              to="/other-income/daily-sheet"
              className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium hover:bg-accent transition-colors"
            >
              <ChartBar size={16} />
              สรุปรายวัน
            </Link>
            <button
              onClick={() => navigate('/other-income/new')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus size={16} />
              สร้างเอกสารใหม่
            </button>
          </div>
        }
      />

      {/* Status filter cards — 4 clickable cards per PDF v2.2 spec */}
      <div className="grid gap-3 mb-6 grid-cols-2 md:grid-cols-4">
        <StatusCard
          label="ทั้งหมด"
          sub="ALL DOCS"
          icon={<FileText size={16} />}
          accent="primary"
          value={allCount}
          active={statusFilter === 'ALL'}
          onClick={() => handleFilterClick('ALL')}
        />
        <StatusCard
          label="ค้างดำเนินการ"
          sub={makerCheckerEnabled ? 'DRAFT + READY' : 'DRAFT'}
          icon={<ClipboardCheck size={16} />}
          accent="warning"
          value={inProgressCount}
          active={statusFilter === 'IN_PROGRESS'}
          onClick={() => handleFilterClick('IN_PROGRESS')}
        />
        <StatusCard
          label="ลงบัญชีแล้ว"
          sub="POSTED"
          icon={<CheckCircle2 size={16} />}
          accent="success"
          value={postedCount}
          active={statusFilter === 'POSTED'}
          onClick={() => handleFilterClick('POSTED')}
        />
        <StatusCard
          label="ยกเลิก"
          sub="REVERSED"
          icon={<RotateCcw size={16} />}
          accent="muted"
          value={reversedCount}
          active={statusFilter === 'REVERSED'}
          onClick={() => handleFilterClick('REVERSED')}
        />
      </div>

      {/* Filters — search + date range (status filter moved to cards above) */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="ค้นหาเลขเอกสาร / คู่ค้า"
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm bg-background"
          />
        </div>
        {/* Date Range Quick Chips (v2.3 — replaces old date inputs + clear button) */}
        <div className="w-full">
          <DateRangeChips
            startDate={startDate}
            endDate={endDate}
            onChange={({ startDate: sd, endDate: ed }) => {
              setStartDate(sd);
              setEndDate(ed);
              setPage(1);
            }}
          />
        </div>
        {/* Custom-range inputs: always rendered so users can type exact dates;
            the "ช่วงวันที่..." chip focuses the first input via DOM query. */}
        <div className="flex flex-wrap items-center gap-2 w-full">
          <input
            type="date"
            data-date-range-custom-start="true"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="border rounded-md px-3 py-2 text-sm bg-background"
            placeholder="วันที่เริ่ม"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="border rounded-md px-3 py-2 text-sm bg-background"
            placeholder="วันที่สิ้นสุด"
          />
        </div>
      </div>

      {/* Table */}
      <QueryBoundary
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        error={listQuery.error}
        onRetry={listQuery.refetch}
      >
        <div className="rounded-xl border bg-card overflow-hidden">
          {docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText size={40} className="text-muted-foreground mb-3 opacity-40" />
              <p className="text-muted-foreground text-sm">ไม่พบเอกสาร</p>
              <button
                onClick={() => navigate('/other-income/new')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90"
              >
                <Plus size={14} /> สร้างเอกสารแรก
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">เลขเอกสาร</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">วันที่</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">คู่ค้า</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">รายได้ก่อนภาษี</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">VAT</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">WHT</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">สุทธิ</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground text-xs">สถานะ</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc: OtherIncome) => (
                    <tr
                      key={doc.id}
                      className="border-b hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => navigate(`/other-income/${doc.id}`)}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-primary">
                        <span className="flex items-center gap-1">
                          {doc.isOverridden && (
                            <span
                              className="text-warning"
                              title="POST ด้วย Override JV — ตรวจ audit log"
                              aria-label="Override JV"
                            >
                              ✏
                            </span>
                          )}
                          {doc.docNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {fmtDate(doc.issueDate)}
                      </td>
                      <td className="px-4 py-3">
                        {doc.counterpartyName ?? doc.customer?.name ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {fmt(doc.incomeGross)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        {fmt(doc.vatAmount)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        {fmt(doc.whtAmount)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">
                        {fmt(doc.netReceived)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={doc.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {doc.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(doc.id);
                              setConfirmDeleteNumber(doc.docNumber);
                            }}
                            className="text-xs text-destructive hover:opacity-80 px-2 py-1 rounded hover:bg-destructive/10"
                          >
                            ลบ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        <PaginationBar
          total={total}
          page={page}
          size={size}
          onPageChange={setPage}
          onSizeChange={setSize}
        />
      </QueryBoundary>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
        title="ลบฉบับร่าง"
        description={`ต้องการลบร่างเอกสาร ${confirmDeleteNumber}? การดำเนินการนี้ไม่สามารถยกเลิกได้`}
        confirmLabel="ลบ"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (confirmDeleteId) deleteMutation.mutate(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}

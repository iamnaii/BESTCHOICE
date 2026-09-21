import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { formatThaiDate } from '@/lib/date';
import { ReopenPeriodModal } from './components/ReopenPeriodModal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  nameTh: string;
  companyCode: string;
}

type PeriodStatus = 'OPEN' | 'REVIEW' | 'CLOSED' | 'SYNCED';

interface Period {
  year: number;
  month: number;
  companyId: string;
  status: PeriodStatus;
  closedAt: string | null;
  closedById: string | null;
  reviewStartedAt: string | null;
  peakSyncedAt: string | null;
}

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<PeriodStatus, string> = {
  OPEN: 'เปิด',
  REVIEW: 'กำลัง Review',
  CLOSED: 'ปิดแล้ว',
  SYNCED: 'Sync PEAK แล้ว',
};

const STATUS_CLASSES: Record<PeriodStatus, string> = {
  OPEN: 'bg-success/10 text-success',
  REVIEW: 'bg-primary/10 text-primary',
  CLOSED: 'bg-warning/10 text-warning-strong',
  SYNCED: 'bg-muted text-muted-foreground',
};

function StatusBadge({ status }: { status: PeriodStatus }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PeriodClosePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [companyId, setCompanyId] = useState<string>('');

  // Confirm close dialog state
  const [confirmingClose, setConfirmingClose] = useState<{ companyId: string; year: number; month: number } | null>(null);

  // Reopen dialog state — modal captures reasonType + reason + taxFiled
  const [reopenTarget, setReopenTarget] = useState<{ companyId: string; year: number; month: number } | null>(null);

  // Load companies and auto-select FINANCE
  const companiesQuery = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: () => api.get<Company[]>('/companies').then((r) => r.data),
  });
  const companies = useMemo(() => (companiesQuery.data ?? [])
    .filter((c) => c.companyCode === 'FINANCE' || c.companyCode === 'SHOP')
    .sort((a, b) => (a.companyCode === 'FINANCE' ? 0 : 1) - (b.companyCode === 'FINANCE' ? 0 : 1)),
  [companiesQuery.data]);

  useEffect(() => {
    if (companies.length > 0 && !companies.some((c) => c.id === companyId)) {
      // Prefer FINANCE company, fall back to first
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  // Load periods for selected company + year
  const periodsQuery = useQuery<Period[]>({
    queryKey: ['accounting-periods', companyId, year],
    queryFn: () =>
      api
        .get<Period[]>('/expenses/periods/overview', { params: { companyId, year } })
        .then((r) => r.data),
    enabled: !!companyId,
  });

  const closeMutation = useMutation({
    mutationFn: (target: { companyId: string; year: number; month: number }) =>
      api.post('/expenses/periods/close', target).then((r) => r.data),
    onSuccess: (_result, target) => {
      toast.success('ปิดงวดเรียบร้อย');
      qc.invalidateQueries({ queryKey: ['accounting-periods', target.companyId, target.year] });
      qc.invalidateQueries({ queryKey: ['accounting-periods', 'reopened'] }); // banner refresh
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof Error ? e.message : 'ปิดงวดไม่สำเร็จ';
      toast.error(msg);
    },
  });

  type ReopenDto = {
    companyId: string;
    year: number;
    month: number;
    reasonType: 'WRONG_ENTRY' | 'MISSED_RECORD' | 'AUDITOR_REQUEST' | 'OTHER';
    reason: string;
    taxFiled: boolean;
    boardResolutionId?: string;
  };

  const reopenMutation = useMutation({
    mutationFn: (dto: ReopenDto) =>
      api.post('/expenses/periods/reopen', dto).then((r) => r.data),
    onSuccess: (_result, target) => {
      toast.success('เปิดงวดเรียบร้อย');
      qc.invalidateQueries({ queryKey: ['accounting-periods', target.companyId, target.year] });
      qc.invalidateQueries({ queryKey: ['accounting-periods', 'reopened'] });
      setReopenTarget(null);
    },
    onError: (e: unknown) => {
      const msg =
        (e as any)?.response?.data?.message ?? (e instanceof Error ? e.message : 'เปิดงวดไม่สำเร็จ');
      toast.error(msg);
    },
  });

  const canClose = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';
  const canReopen = user?.role === 'OWNER';
  const isActing = closeMutation.isPending || reopenMutation.isPending;
  const companyLabel = (id: string) => {
    const company = companies.find((c) => c.id === id);
    return company ? `${company.nameTh} (${company.companyCode})` : '';
  };

  return (
    <Tabs value={companyId} onValueChange={setCompanyId} className="p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="rounded-xl border px-6 py-4 bg-card">
        <h2 className="text-2xl font-bold leading-snug">งวดบัญชี (Accounting Periods)</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          ปิดงวดหลังยื่น ภ.พ.30 เพื่อ block การบันทึกย้อนหลัง
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Separate company tabs keep each business's periods visible. */}
        <QueryBoundary
          isLoading={companiesQuery.isLoading}
          isError={companiesQuery.isError}
          error={companiesQuery.error}
          onRetry={companiesQuery.refetch}
          loadingFallback={
            <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
          }
        >
          <TabsList aria-label="เลือกนิติบุคคล" className="max-w-full overflow-x-auto">
            {companies.map((c) => (
              <TabsTrigger key={c.id} value={c.id} disabled={isActing} className="leading-snug">
                {c.companyCode === 'FINANCE' ? 'FINANCE (การเงิน)' : c.companyCode === 'SHOP' ? 'SHOP (หน้าร้าน)' : c.companyCode}
              </TabsTrigger>
            ))}
          </TabsList>
        </QueryBoundary>

        {/* Year selector */}
        <select
          value={year}
          disabled={isActing}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background"
          aria-label="เลือกปี"
        >
          {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
            <option key={y} value={y}>
              {y + 543}
            </option>
          ))}
        </select>
      </div>

      {/* Periods table */}
      <TabsContent value={companyId} className="space-y-3">
      {companyId && <p className="text-sm font-medium leading-snug">{companyLabel(companyId)}</p>}
      <QueryBoundary
        isLoading={periodsQuery.isLoading && !!companyId}
        isError={periodsQuery.isError}
        error={periodsQuery.error}
        onRetry={periodsQuery.refetch}
      >
        {!companyId ? (
          <p className="text-muted-foreground text-sm py-8 text-center">กรุณาเลือกนิติบุคคล</p>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    งวด
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    สถานะ
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    ปิดเมื่อ
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    Review
                  </th>
                  {(canClose || canReopen) && (
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                      การจัดการ
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {(periodsQuery.data ?? []).map((p) => (
                  <tr key={`${p.year}-${p.month}`} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-mono font-semibold">
                      {THAI_MONTHS[p.month - 1]} {p.year}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatThaiDate(p.closedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatThaiDate(p.reviewStartedAt)}
                    </td>
                    {(canClose || canReopen) && (
                      <td className="px-4 py-2.5 text-right">
                        {canClose && (p.status === 'OPEN' || p.status === 'REVIEW') && (
                          <button
                            type="button"
                            disabled={isActing}
                            onClick={() => setConfirmingClose({ companyId: p.companyId, year: p.year, month: p.month })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-md hover:bg-accent disabled:opacity-50"
                          >
                            <Lock size={12} /> ปิดงวด
                          </button>
                        )}
                        {canReopen && p.status === 'CLOSED' && (
                          <button
                            type="button"
                            disabled={isActing}
                            onClick={() => setReopenTarget({ companyId: p.companyId, year: p.year, month: p.month })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-md hover:bg-accent disabled:opacity-50"
                          >
                            <Unlock size={12} /> เปิดงวด
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>
      </TabsContent>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        {(Object.entries(STATUS_LABELS) as [PeriodStatus, string][]).map(([s, label]) => (
          <div key={s} className="flex items-center gap-1">
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_CLASSES[s]}`}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Close period confirm dialog */}
      <ConfirmDialog
        open={confirmingClose !== null}
        onOpenChange={(open) => { if (!open) setConfirmingClose(null); }}
        title="ปิดงวดบัญชี"
        description={
          confirmingClose !== null
            ? `${companyLabel(confirmingClose.companyId)}\nปิดงวด ${THAI_MONTHS[confirmingClose.month - 1]} ${confirmingClose.year + 543}?\nหลังปิดจะไม่สามารถบันทึกย้อนหลังงวดนี้ได้`
            : ''
        }
        confirmLabel="ปิดงวด"
        variant="destructive"
        loading={closeMutation.isPending}
        onConfirm={() => {
          if (confirmingClose !== null) closeMutation.mutate(confirmingClose);
          setConfirmingClose(null);
        }}
      />

      {/* Reopen period modal — structured reason taxonomy */}
      <ReopenPeriodModal
        open={reopenTarget !== null}
        period={
          reopenTarget
            ? `${companyLabel(reopenTarget.companyId)} · ${THAI_MONTHS[reopenTarget.month - 1]} ${reopenTarget.year + 543}`
            : ''
        }
        onConfirm={(payload) => {
          if (!reopenTarget) return;
          reopenMutation.mutate({ ...reopenTarget, ...payload });
        }}
        onCancel={() => setReopenTarget(null)}
      />
    </Tabs>
  );
}

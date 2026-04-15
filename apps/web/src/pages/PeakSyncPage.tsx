import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, RefreshCw, Link2, Calendar, Database } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, accountingPeriodStatusMap } from '@/lib/status-badges';
import { formatDateMedium } from '@/utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PeakStatus {
  configured: boolean;
  baseUrl: string;
  message: string;
}

interface Company {
  id: string;
  name: string;
  companyCode: string;
  vatRegistered: boolean;
}

type PeriodStatus = 'OPEN' | 'REVIEW' | 'CLOSED' | 'SYNCED';

interface PeriodStatusResult {
  companyId: string;
  year: number;
  month: number;
  status: PeriodStatus;
  closedAt: string | null;
  peakSyncedAt: string | null;
  notes: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];


// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className="relative flex h-3 w-3 shrink-0">
      {ok && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex rounded-full h-3 w-3 ${ok ? 'bg-green-500' : 'bg-red-500'}`}
      />
    </span>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  colorClass,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  colorClass: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 flex items-center gap-4 shadow-sm">
      <div className={`rounded-lg p-3 ${colorClass}`}>{icon}</div>
      <div>
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PeakSyncPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch PEAK status
  const statusQuery = useQuery<PeakStatus>({
    queryKey: ['peak-status'],
    queryFn: async () => (await api.get('/peak/status')).data,
  });

  // Fetch companies to find FINANCE company
  const companiesQuery = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies')).data,
  });

  const financeCompany = companiesQuery.data?.find((c) => c.vatRegistered) ?? null;

  // Fetch periods overview for selected year
  const periodsQuery = useQuery<PeriodStatusResult[]>({
    queryKey: ['periods-overview', financeCompany?.id, selectedYear],
    queryFn: async () =>
      (
        await api.get('/expenses/periods/overview', {
          params: { companyId: financeCompany!.id, year: selectedYear },
        })
      ).data,
    enabled: !!financeCompany,
  });

  const periods = periodsQuery.data ?? [];

  // Computed summaries
  const syncedCount = periods.filter((p) => p.status === 'SYNCED').length;
  const pendingCount = periods.filter((p) => p.status === 'CLOSED').length;
  const peakConfigured = statusQuery.data?.configured ?? false;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([statusQuery.refetch(), periodsQuery.refetch()]);
    setIsRefreshing(false);
  };

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div>
      <PageHeader
        title="PEAK Sync"
        subtitle="ตรวจสอบสถานะการเชื่อมต่อและส่งข้อมูลไปยัง PEAK"
        action={
          <div className="flex items-center gap-3">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="text-sm border border-input rounded-lg px-3 py-2 bg-background"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  ปี {y + 543} ({y})
                </option>
              ))}
            </select>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted/50 disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              รีเฟรช
            </button>
          </div>
        }
      />

      {/* Connection Status Card */}
      <QueryBoundary
        isLoading={statusQuery.isLoading}
        isError={statusQuery.isError}
        error={statusQuery.error}
        onRetry={() => statusQuery.refetch()}
      >
        {statusQuery.data && (
          <div
            className={`mb-6 rounded-xl border p-5 flex items-start gap-4 shadow-sm ${
              peakConfigured
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
                : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
            }`}
          >
            <div className="mt-0.5">
              {peakConfigured ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <StatusDot ok={peakConfigured} />
                <span className="font-semibold text-[15px]">
                  {peakConfigured ? 'เชื่อมต่อ PEAK สำเร็จ' : 'ยังไม่ได้เชื่อมต่อ PEAK'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{statusQuery.data.message}</p>
              {statusQuery.data.baseUrl && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  {statusQuery.data.baseUrl}
                </p>
              )}
            </div>
          </div>
        )}
      </QueryBoundary>

      {/* Summary Cards */}
      <QueryBoundary
        isLoading={companiesQuery.isLoading || periodsQuery.isLoading}
        isError={periodsQuery.isError || companiesQuery.isError}
        error={periodsQuery.error ?? companiesQuery.error}
        onRetry={() => periodsQuery.refetch()}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <SummaryCard
            label="ส่ง PEAK แล้ว (ปีนี้)"
            value={syncedCount}
            icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
            colorClass="bg-emerald-100"
          />
          <SummaryCard
            label="รอส่ง PEAK (ปิดแล้ว)"
            value={pendingCount}
            icon={<Database className="w-5 h-5 text-blue-600" />}
            colorClass="bg-blue-100"
          />
          <SummaryCard
            label="สถานะการเชื่อมต่อ"
            value={peakConfigured ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}
            icon={
              peakConfigured ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600" />
              )
            }
            colorClass={peakConfigured ? 'bg-emerald-100' : 'bg-red-100'}
          />
        </div>

        {/* Monthly Table */}
        {financeCompany && (
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-[14px]">
                ภาพรวมรายเดือน — {financeCompany.name} — ปี {selectedYear + 543} ({selectedYear})
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      เดือน
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      สถานะงวด
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      วันที่ Sync PEAK
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      วันที่ปิดงวด
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      หมายเหตุ
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {periods.map((period) => {
                    const cfg = getStatusBadgeProps(period.status, accountingPeriodStatusMap);
                    return (
                      <tr
                        key={`${period.year}-${period.month}`}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-5 py-3.5 font-medium text-foreground">
                          {THAI_MONTHS[period.month - 1]}
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge variant={cfg.variant} appearance={cfg.appearance}>
                            {cfg.label}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {period.peakSyncedAt ? (
                            <span className="text-emerald-700 font-medium">
                              {formatDateMedium(period.peakSyncedAt)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {period.closedAt ? (
                            formatDateMedium(period.closedAt)
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground text-xs max-w-[200px] truncate">
                          {period.notes ?? <span className="text-muted-foreground/60">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {periods.length === 0 && !periodsQuery.isLoading && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  ไม่พบข้อมูลงวดบัญชี
                </div>
              )}
            </div>
          </div>
        )}

        {!financeCompany && !companiesQuery.isLoading && (
          <div className="rounded-xl border border-border/50 bg-card shadow-sm p-8 text-center text-sm text-muted-foreground">
            ไม่พบบริษัท FINANCE (VAT) — กรุณาตั้งค่าบริษัทก่อนใช้งาน
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

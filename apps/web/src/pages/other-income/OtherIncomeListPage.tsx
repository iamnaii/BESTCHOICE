import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, FileText, TrendingUp, Receipt, RotateCcw } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { useDebounce } from '@/hooks/useDebounce';
import { otherIncomeApi } from '@/lib/otherIncome';
import type { OtherIncome, OtherIncomeStatus } from '@/lib/otherIncome.types';

const STATUS_LABELS: Record<OtherIncomeStatus, string> = {
  DRAFT: 'ร่าง',
  POSTED: 'บันทึกแล้ว',
  REVERSED: 'กลับรายการ',
};

const STATUS_COLORS: Record<OtherIncomeStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
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
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function OtherIncomeListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<OtherIncomeStatus | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  const debouncedQ = useDebounce(q, 300);

  const listQuery = useQuery({
    queryKey: ['other-income', 'list', debouncedQ, status, startDate, endDate, page],
    queryFn: () =>
      otherIncomeApi.list({
        q: debouncedQ || undefined,
        status: status || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        page,
        limit: 50,
      }),
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
  const totalPages = Math.ceil(total / 50) || 1;

  // Summary cards from current page data
  const postedDocs = docs.filter((d) => d.status === 'POSTED');
  const draftDocs = docs.filter((d) => d.status === 'DRAFT');
  const totalPostedGross = postedDocs.reduce((s, d) => s + parseFloat(d.incomeGross || '0'), 0);
  const totalPostedNet = postedDocs.reduce((s, d) => s + parseFloat(d.netReceived || '0'), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="รายได้อื่น"
        subtitle="จัดการเอกสารรายได้นอกเหนือจากสัญญาผ่อนชำระ"
        icon={<Receipt size={20} />}
        action={
          <button
            onClick={() => navigate('/other-income/new')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            สร้างเอกสารใหม่
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText size={16} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">เอกสารทั้งหมด</span>
          </div>
          <p className="text-2xl font-bold font-mono">{total}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} className="text-success" />
            <span className="text-xs text-muted-foreground">บันทึกแล้ว</span>
          </div>
          <p className="text-2xl font-bold font-mono text-success">{postedDocs.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Receipt size={16} className="text-primary" />
            <span className="text-xs text-muted-foreground">รวมรายได้ก่อนภาษี</span>
          </div>
          <p className="text-xl font-bold font-mono">{fmt(totalPostedGross)} ฿</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <RotateCcw size={16} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">สุทธิที่รับ</span>
          </div>
          <p className="text-xl font-bold font-mono">{fmt(totalPostedNet)} ฿</p>
        </div>
      </div>

      {/* Filters */}
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
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as OtherIncomeStatus | ''); setPage(1); }}
          className="border rounded-md px-3 py-2 text-sm bg-background min-w-[130px]"
        >
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">ร่าง</option>
          <option value="POSTED">บันทึกแล้ว</option>
          <option value="REVERSED">กลับรายการ</option>
        </select>
        <input
          type="date"
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
        {(q || status || startDate || endDate) && (
          <button
            type="button"
            onClick={() => { setQ(''); setStatus(''); setStartDate(''); setEndDate(''); setPage(1); }}
            className="px-3 py-2 text-sm border rounded-md hover:bg-accent"
          >
            ล้างตัวกรอง
          </button>
        )}
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
                        {doc.docNumber}
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
                              if (confirm(`ลบร่าง ${doc.docNumber}?`)) {
                                deleteMutation.mutate(doc.id);
                              }
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
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-muted-foreground">
              แสดง {docs.length} จาก {total} รายการ
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ก่อนหน้า
              </button>
              <span className="px-3 py-1.5 text-muted-foreground">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 border rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

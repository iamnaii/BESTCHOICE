import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PackageMinus, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import type { AdjustmentReason, AdjustmentStatus, CurrentActor, StockAdjustmentRow } from './types';
import { REASON_OPTIONS, canRequest, formatBaht } from './stock-adjustment.util';
import { useAdjustmentList } from './hooks/useStockAdjustments';
import AdjustmentTable from './components/AdjustmentTable';
import RequestAdjustmentDialog from './components/RequestAdjustmentDialog';
import ApproveAdjustmentDialog from './components/ApproveAdjustmentDialog';

type Tab = 'pending' | 'history' | 'damaged' | 'journal';

const INPUT_CLS =
  'px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

/**
 * หน้า "ตัดสินค้า" (ก้อน 3 · 2026-10-05) — คำขอตัดสินค้าให้เจ้าของอนุมัติ: รออนุมัติ / ประวัติ / เสียหายคงในสต๊อก / รายการบัญชี
 * ผู้ขอ = SALES/BM/OWNER (สาขาตัวเอง) · อนุมัติ = OWNER · อ่าน = ทุก role ที่เห็นหน้าคลัง
 */
export default function StockAdjustmentsPage() {
  const { user: authUser } = useAuth();
  const user: CurrentActor = { id: authUser?.id ?? '', role: authUser?.role ?? '', branchId: authUser?.branchId ?? null };
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('pending');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [page, setPage] = useState(1);
  const [showRequest, setShowRequest] = useState(false);
  const [openId, setOpenId] = useState<string | null>(searchParams.get('focus'));

  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch, reason]);

  const status: AdjustmentStatus | '' = tab === 'pending' ? 'PENDING_APPROVAL' : tab === 'damaged' || tab === 'journal' ? 'APPROVED' : '';
  const list = useAdjustmentList({
    status,
    reason: tab === 'damaged' ? 'DAMAGED' : reason,
    search: debouncedSearch,
    page,
    limit: 50,
  });
  const rows = useMemo(() => {
    const data = list.data?.data ?? [];
    if (tab === 'damaged') return data.filter((r) => r.product.status === 'DAMAGED' && !r.product.deletedAt);
    if (tab === 'journal') return data.filter((r) => !!r.journalEntryNo || r.inventoryBooked === false);
    return data;
  }, [list.data, tab]);

  // การ์ดสรุป — นับจาก total ของรายการ (limit 1 ไม่ดึงทั้งหน้า)
  const pendingCount = useAdjustmentList({ status: 'PENDING_APPROVAL', limit: 1 });
  const approvedMonth = useAdjustmentList({ status: 'APPROVED', startDate: monthStart(), limit: 1 });
  const damagedRows = useAdjustmentList({ status: 'APPROVED', reason: 'DAMAGED', limit: 100 });
  const rejectedMonth = useAdjustmentList({ status: 'REJECTED', startDate: monthStart(), limit: 1 });
  const canceledMonth = useAdjustmentList({ status: 'CANCELED', startDate: monthStart(), limit: 1 });
  const damagedInStock = (damagedRows.data?.data ?? []).filter((r) => r.product.status === 'DAMAGED' && !r.product.deletedAt);
  const damagedValue = damagedInStock.reduce((s, r) => s + Number(r.product.costPrice || 0), 0);

  const openRow = (row: StockAdjustmentRow) => setOpenId(row.id);
  const closeDetail = () => {
    setOpenId(null);
    if (searchParams.has('focus')) {
      searchParams.delete('focus');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'pending', label: 'รออนุมัติ', count: pendingCount.data?.total },
    { key: 'history', label: 'ประวัติทั้งหมด' },
    { key: 'damaged', label: 'เสียหายคงในสต๊อก' },
    { key: 'journal', label: 'รายการบัญชี' },
  ];

  return (
    <div>
      <PageHeader
        title="ตัดสินค้า"
        subtitle="คำขอสูญหาย / เสียหาย / ตัดจำหน่าย / พบของคืน — เจ้าของอนุมัติทุกรายการ"
        icon={<PackageMinus className="size-5" />}
        action={
          canRequest(user) ? (
            <Button onClick={() => setShowRequest(true)}>
              <Plus className="size-4" />
              ขอตัดสินค้า
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="รออนุมัติ" value={pendingCount.data?.total ?? 0} tone="warning" />
        <SummaryCard label="อนุมัติเดือนนี้" value={approvedMonth.data?.total ?? 0} tone="primary" />
        <SummaryCard label="เสียหายคงในสต๊อก" value={damagedInStock.length} hint={formatBaht(damagedValue)} tone="destructive" />
        <SummaryCard label="ไม่อนุมัติ/ยกเลิก เดือนนี้" value={(rejectedMonth.data?.total ?? 0) + (canceledMonth.data?.total ?? 0)} tone="muted" />
      </div>

      <div className="flex gap-1 mb-4 bg-muted rounded-xl p-1 w-fit flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors inline-flex items-center gap-2 ${
              tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count ? (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium bg-warning/10 text-warning-strong">
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหาเลขคำขอ, ยี่ห้อ, รุ่น, IMEI..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${INPUT_CLS} flex-1 min-w-[220px]`}
        />
        {tab !== 'damaged' && (
          <select value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason | '')} className={INPUT_CLS}>
            <option value="">ทุกเหตุผล</option>
            {REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <QueryBoundary
        isLoading={list.isLoading && !list.data}
        isError={list.isError}
        error={list.error}
        onRetry={list.refetch}
        errorTitle="ไม่สามารถโหลดรายการตัดสินค้าได้"
      >
        <>
          <AdjustmentTable
            rows={rows}
            isLoading={list.isLoading}
            user={user}
            onOpen={openRow}
            emptyMessage={
              tab === 'pending'
                ? 'ไม่มีคำขอรออนุมัติ'
                : tab === 'damaged'
                  ? 'ไม่มีเครื่องเสียหายคงในสต๊อก'
                  : tab === 'journal'
                    ? 'ยังไม่มีรายการที่ลงบัญชี'
                    : 'ยังไม่มีรายการ'
            }
          />
          {list.data && list.data.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                ก่อนหน้า
              </Button>
              <span className="px-3 py-1.5 text-sm text-muted-foreground">
                {page} / {list.data.totalPages}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(list.data!.totalPages, p + 1))} disabled={page === list.data.totalPages}>
                ถัดไป
              </Button>
            </div>
          )}
        </>
      </QueryBoundary>

      <RequestAdjustmentDialog open={showRequest} onClose={() => setShowRequest(false)} />
      <ApproveAdjustmentDialog adjustmentId={openId} onClose={closeDetail} user={user} />
    </div>
  );
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone: 'warning' | 'primary' | 'destructive' | 'muted' }) {
  const bar =
    tone === 'warning' ? 'bg-warning' : tone === 'primary' ? 'bg-primary' : tone === 'destructive' ? 'bg-destructive' : 'bg-muted-foreground';
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-r-full ${bar}`} />
      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 leading-snug">{label}</div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value.toLocaleString()}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

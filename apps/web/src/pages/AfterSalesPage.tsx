import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDebounce } from '@/hooks/useDebounce';
import IntakeBox from './after-sales/IntakeBox';
import SummaryStrip from './after-sales/SummaryStrip';
import CaseTable from './after-sales/CaseTable';
import ApprovalTable, { type ApprovalAction } from './after-sales/ApprovalTable';
import { ApprovePricedDialog, RejectExchangeDialog } from './after-sales/ExchangeActionDialogs';
import Pager from './after-sales/Pager';
import { afterSalesKeys, type CaseRow, type ListResponse } from './after-sales/after-sales';

/** mirror ของ LIST_FETCH_CAP ฝั่ง API (after-sales-query.service.ts) — B3 final-fix brief:
 * Y = ceil(min(total, 500)/limit) เมื่อ truncated */
const LIST_FETCH_CAP = 500;

/** mirror ของ CROSS_BRANCH_ROLES ฝั่ง API (branch-access.util.ts) — role อื่นล็อกสาขาตัวเอง
 * (pattern เดียวกับ TradeInPage/components/AcceptModal.tsx และ LettersPage) */
const CROSS_BRANCH_ROLES = new Set(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']);

type Tab = 'ACTIVE' | 'AWAITING_APPROVAL' | 'READY' | 'DONE';
const TABS: Tab[] = ['ACTIVE', 'AWAITING_APPROVAL', 'READY', 'DONE'];
const TAB_LABEL: Record<Tab, string> = {
  ACTIVE: 'กำลังทำ',
  AWAITING_APPROVAL: 'รออนุมัติ',
  READY: 'รอลูกค้ารับ',
  DONE: 'เสร็จแล้ว',
};

/** R25 (c) — ตัวกรองทั้งหมดของหน้านี้อยู่ในสถานะเดียว: ทุก setter ของตัวกรองตั้ง `page: 1` มาพร้อมกัน
 * ในการอัปเดตครั้งเดียว (ไม่ใช่ setTab แล้วค่อย setPage แยกกันผ่าน useEffect เหมือนเดิม — แบบเดิมยิง
 * request ซ้ำสองครั้งเมื่อสลับแท็บขณะไม่ได้อยู่หน้า 1: ครั้งแรกด้วยแท็บใหม่+เพจเก่า ครั้งที่สองหลัง
 * effect รีเซ็ตเพจ) */
interface Filters {
  tab: Tab;
  q: string;
  staleOnly: boolean;
  branchId: string;
  page: number;
}
const INITIAL_FILTERS: Filters = { tab: 'ACTIVE', q: '', staleOnly: false, branchId: '', page: 1 };

/** Task 12 (moved from Task 13) — ?tab= ที่มากับ URL ตั้งต้นแท็บของหน้าได้ (จาก redirect ของ
 * /insurance/exchange-requests เดิม) แต่ต้องเป็นแท็บที่ role นี้เห็นจริง — ไม่งั้น SALES ตาม
 * ลิงก์เก่ามาจะได้แท็บ "รออนุมัติ" ที่เขาไม่มีสิทธิ์เห็น */
function initialTabFrom(tabParam: string | null, role: string | undefined): Tab {
  if (!tabParam || !(TABS as string[]).includes(tabParam)) return INITIAL_FILTERS.tab;
  if (tabParam === 'AWAITING_APPROVAL' && role === 'SALES') return INITIAL_FILTERS.tab;
  return tabParam as Tab;
}

export default function AfterSalesPage() {
  useDocumentTitle('หลังการขาย');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const crossBranch = !!user && CROSS_BRANCH_ROLES.has(user.role);

  const [search, setSearch] = useState('');
  const debouncedQ = useDebounce(search, 300);
  // R25 (c) + Task 12 — useState initializer เดียว (ไม่ใช่ effect) กัน request ซ้ำสองครั้งตอนโหลด
  // ครั้งแรกที่มี ?tab= (อ่านค่าตอน mount ครั้งเดียว ไม่ตามการเปลี่ยนของ searchParams ทีหลัง)
  const [filters, setFilters] = useState<Filters>(() => ({
    ...INITIAL_FILTERS,
    tab: initialTabFrom(searchParams.get('tab'), user?.role),
  }));
  const [approveDialog, setApproveDialog] = useState<{
    id: string;
    mode: 'MEMO' | 'PRICED';
  } | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{
    id: string;
    kind: 'SAME_MODEL' | 'PRICED';
  } | null>(null);

  function handleRowAction(row: CaseRow, action: ApprovalAction) {
    if (action === 'confirm') {
      navigate(`/after-sales/${row.id}?action=confirm`);
      return;
    }
    if (action === 'open') {
      navigate(`/after-sales/${row.id}`);
      return;
    }
    if (action === 'approve') {
      setApproveDialog({ id: row.id, mode: row.exchange?.mode === 'MEMO' ? 'MEMO' : 'PRICED' });
      return;
    }
    setRejectDialog({
      id: row.id,
      kind: row.exchange?.kind === 'SAME_MODEL' ? 'SAME_MODEL' : 'PRICED',
    });
  }
  // R25 (b) — totalPages "ยืนยันแล้ว" จากข้อมูลจริงล่าสุดที่ fetch สำเร็จ ใช้เป็นเพดาน clamp ของเพจ
  // ปัจจุบัน (กันหน้าที่เคยอยู่ค้างเกินจริงหลังตัวกรอง/ข้อมูลเปลี่ยนจนจำนวนหน้าลดลง เช่นแท็บอื่นมีของ
  // น้อยกว่า) — อัปเดตทีหลังผ่าน effect ด้านล่าง ไม่ใช่คำนวณสดในเรนเดอร์เดียวกับ query เพราะ query เอง
  // ต้องใช้ค่านี้ตั้งแต่ก่อนรู้ผล fetch รอบถัดไป
  const [totalPages, setTotalPages] = useState(1);

  // R25 (c) — คำค้น (หลัง debounce) เปลี่ยนก็ต้องกลับไปหน้า 1 เหมือนตัวกรองอื่น ในการอัปเดตครั้งเดียว
  // (setFilters ครั้งเดียวตั้งทั้ง q และ page — ไม่ใช่สอง state แยกกัน ซึ่งจะยิง request ซ้ำ)
  useEffect(() => {
    setFilters((f) => (f.q === debouncedQ ? f : { ...f, q: debouncedQ, page: 1 }));
  }, [debouncedQ]);

  const branches = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: crossBranch,
    staleTime: 60_000,
  });

  // แท็บ "รออนุมัติ" ซ่อมสำหรับ SALES (spec Task 9)
  const visibleTabs = TABS.filter((t) => t !== 'AWAITING_APPROVAL' || user?.role !== 'SALES');

  // R25 (b) — Pager clamp: หน้าที่ขอจริง (`filters.page`) อาจเกินจำนวนหน้าจริงหลังตัวกรอง/ข้อมูล
  // เปลี่ยน — ใช้ safePage ทั้งใน query (คีย์ + params ที่ยิงจริง) และใน <Pager> ผู้เรียกเป็นคน clamp
  // เอง (Pager.tsx ยังเป็น dumb component เหมือนเดิม)
  const safePage = Math.min(filters.page, totalPages);

  const query = useQuery<ListResponse>({
    queryKey: afterSalesKeys.list({
      tab: filters.tab,
      q: filters.q,
      stale: filters.staleOnly,
      branchId: filters.branchId,
      page: safePage,
    }),
    queryFn: async () =>
      (
        await api.get('/after-sales', {
          params: {
            tab: filters.tab,
            q: filters.q || undefined,
            stale: filters.staleOnly || undefined,
            summary: 1,
            branchId: filters.branchId || undefined,
            page: safePage,
          },
        })
      ).data,
    // เคสเปิด/ปิดเปลี่ยนได้ตลอดวัน — ต้องไม่เห็นของเก่าจาก cache ตอนกลับมาหน้านี้
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // B2/B3 (final-fix brief) — Y = ceil(min(total, 500)/limit) เมื่อ truncated มิฉะนั้น ceil(total/limit)
  const total = query.data?.total ?? 0;
  const limit = query.data?.limit ?? 50;
  const truncated = query.data?.truncated ?? false;

  useEffect(() => {
    if (!query.data) return;
    const cap = truncated ? Math.min(total, LIST_FETCH_CAP) : total;
    const next = Math.max(1, Math.ceil(cap / limit));
    setTotalPages((prev) => (prev === next ? prev : next));
  }, [query.data, total, limit, truncated]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="หลังการขาย"
        subtitle="ทุกเรื่องหลังการขายอยู่ที่นี่ — เช็คประกัน · ซ่อม · เปลี่ยนเครื่อง"
        action={
          crossBranch && branches.data ? (
            <select
              id="after-sales-branch"
              aria-label="สาขา"
              value={filters.branchId}
              onChange={(e) => setFilters((f) => ({ ...f, branchId: e.target.value, page: 1 }))}
              className="h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm sm:w-48"
            >
              <option value="">ทุกสาขา</option>
              {branches.data.map((b) => (
                <option key={b.id} value={b.id}>
                  สาขา {b.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      <IntakeBox />

      {query.data?.summary && (
        <SummaryStrip
          summary={query.data.summary}
          showMoney={query.data.summary.repairCostShop != null}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="สถานะเคส" className="flex flex-wrap gap-2">
          {visibleTabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={filters.tab === t}
              onClick={() => setFilters((f) => ({ ...f, tab: t, page: 1 }))}
              className={`min-h-11 rounded-full border px-3.5 text-sm leading-snug ${
                filters.tab === t
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'border-border bg-card text-foreground hover:bg-accent'
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={filters.staleOnly}
          onClick={() => setFilters((f) => ({ ...f, staleOnly: !f.staleOnly, page: 1 }))}
          className={`min-h-11 rounded-full border px-3.5 text-sm leading-snug ${
            filters.staleOnly
              ? 'border-warning bg-warning/10 font-semibold text-warning-strong'
              : 'border-border bg-card text-foreground hover:bg-accent'
          }`}
        >
          ค้างนาน
        </button>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นเลขเคส / IMEI / ชื่อ / เบอร์ / เลขสัญญา"
          aria-label="ค้นหาเคส"
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3.5 text-sm sm:max-w-xs"
        />
      </div>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        {query.data && (
          <div className="space-y-2">
            {filters.tab === 'AWAITING_APPROVAL' ? (
              <ApprovalTable
                rows={query.data.data}
                role={user?.role ?? ''}
                onAction={handleRowAction}
              />
            ) : (
              <CaseTable rows={query.data.data} />
            )}
            <Pager
              page={safePage}
              totalPages={totalPages}
              total={total}
              onPrev={() => setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))}
              onNext={() => setFilters((f) => ({ ...f, page: Math.min(totalPages, f.page + 1) }))}
            />
            {truncated && (
              <p className="text-xs leading-snug text-muted-foreground">
                แสดงได้สูงสุด 500 เคสล่าสุดในแท็บนี้ — ใช้ช่องค้นหาเพื่อหาเคสที่เหลือ
              </p>
            )}
          </div>
        )}
      </QueryBoundary>

      <p className="text-xs leading-snug text-muted-foreground">
        ป้ายค้างนาน: ส่งซ่อมเกิน 14 วัน · รอรับเกิน 7 วัน · รออนุมัติเกิน 2 วัน
      </p>

      {approveDialog && (
        <ApprovePricedDialog
          caseId={approveDialog.id}
          open
          onOpenChange={(next) => {
            if (!next) setApproveDialog(null);
          }}
          mode={approveDialog.mode}
        />
      )}
      {rejectDialog && (
        <RejectExchangeDialog
          caseId={rejectDialog.id}
          open
          onOpenChange={(next) => {
            if (!next) setRejectDialog(null);
          }}
          kind={rejectDialog.kind}
        />
      )}
    </div>
  );
}

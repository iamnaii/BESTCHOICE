import { useEffect, useState } from 'react';
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
import Pager from './after-sales/Pager';
import { afterSalesKeys, type ListResponse } from './after-sales/after-sales';

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

export default function AfterSalesPage() {
  useDocumentTitle('หลังการขาย');
  const { user } = useAuth();
  const crossBranch = !!user && CROSS_BRANCH_ROLES.has(user.role);

  const [branchId, setBranchId] = useState('');
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const [staleOnly, setStaleOnly] = useState(false);
  const [page, setPage] = useState(1);

  // B2 (final-fix brief) — เปลี่ยนแท็บหรือคำค้นแล้วต้องกลับไปหน้า 1 เสมอ ไม่งั้นหน้าที่เคยอยู่
  // (เช่นหน้า 5) อาจไม่มีอยู่จริงในแท็บ/คำค้นใหม่
  useEffect(() => {
    setPage(1);
  }, [tab, q, staleOnly, branchId]);

  const branches = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: crossBranch,
    staleTime: 60_000,
  });

  // แท็บ "รออนุมัติ" ซ่อมสำหรับ SALES (spec Task 9)
  const visibleTabs = TABS.filter((t) => t !== 'AWAITING_APPROVAL' || user?.role !== 'SALES');

  const query = useQuery<ListResponse>({
    queryKey: afterSalesKeys.list({ tab, q, stale: staleOnly, branchId, page }),
    queryFn: async () =>
      (
        await api.get('/after-sales', {
          params: {
            tab,
            q: q || undefined,
            stale: staleOnly || undefined,
            summary: 1,
            branchId: branchId || undefined,
            page,
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
  const totalPages = Math.max(1, Math.ceil((truncated ? Math.min(total, LIST_FETCH_CAP) : total) / limit));

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
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
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
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-11 rounded-full border px-3.5 text-sm leading-snug ${
                tab === t
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
          aria-pressed={staleOnly}
          onClick={() => setStaleOnly((v) => !v)}
          className={`min-h-11 rounded-full border px-3.5 text-sm leading-snug ${
            staleOnly
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
            <CaseTable rows={query.data.data} />
            <Pager
              page={page}
              totalPages={totalPages}
              total={total}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
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
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import CustomerCreateDialog, { splitDisplayName } from '@/components/customer/CustomerCreateDialog';
import { isChatVisibleForRole } from '@/config/menu';
import { useAuth } from '@/contexts/AuthContext';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useUiFlags } from '@/hooks/useUiFlags';
import api, { getErrorMessage } from '@/lib/api';
import { canCreateCustomer as canCreateCustomerRole } from '@/lib/constants';
import type { CustomerFormData } from '@/lib/schemas';
import CustomerFilterBar from './components/CustomerFilterBar';
import CustomerKpiCards, {
  customerKpiCards,
  prospectKpiCards,
} from './components/CustomerKpiCards';
import CustomerListTable from './components/CustomerListTable';
import CustomerViewSwitch from './components/CustomerViewSwitch';
import ProspectFilterBar from './components/ProspectFilterBar';
import { buildCustomerColumns } from './components/customerColumns';
import { buildProspectColumns } from './components/prospectColumns';
import { useCustomersQuery } from './hooks/useCustomersQuery';
import { sortDirectionLabel, toApiSort, toColumnSort, type SortableColumn } from './sortKeys';
import { exportCustomers } from './utils/customersExport';
import type { AnyCustomerRow, CustomerRow, ProspectRow } from './types';

/**
 * หน้า /customers — สองแท็บ: **ลูกค้า** (ซื้อกับเราแล้ว) กับ **ผู้สนใจ** (ยังไม่เคยซื้อ)
 * ตาม mockup ที่เจ้าของเคาะ (canvas b9970710 v10)
 *
 * ⚠️ ไฟล์พี่น้อง `pages/CustomersPage.tsx` ถูกลบไปแล้ว — ไฟล์เดี่ยวชนะโฟลเดอร์ในการ resolve
 * ของ Vite/TS ถ้าเหลือไว้โค้ดชุดนี้จะไม่ถูกโหลดเลย (`App.tsx:45` import จากโฟลเดอร์นี้)
 */
export default function CustomersPage() {
  useDocumentTitle('ลูกค้า');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { exportEnabled } = useUiFlags();
  const { copy } = useCopyToClipboard();

  const role = user?.role ?? '';
  const isOwner = role === 'OWNER';
  const isOwnerOrManager = ['OWNER', 'BRANCH_MANAGER'].includes(role);
  const canViewSalary = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(role);
  // ต้องตรงกับ `@Roles` ของ `POST /customers` — รายการอยู่ที่ lib/constants ใช้ร่วมกับแผงขวาห้องแชท
  const canCreateCustomer = canCreateCustomerRole(role);
  // ACCOUNTANT เปิด /customers ได้ แต่ /inbox ไม่ได้ (App.tsx) ⇒ โลโก้แชทห้ามเป็นลิงก์
  const canOpenChat = isChatVisibleForRole(role);
  const canCreateSale = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(role);

  const q = useCustomersQuery();
  const {
    view,
    setView,
    isBuyers,
    summary,
    viewCounts,
    customerResult,
    prospectResult,
    total,
    totalPages,
    page,
    setPage,
    sort,
    setSort,
    setFilters,
    hasActiveFilters,
    buildParams,
  } = q;

  // ── โมดัล "เพิ่มลูกค้าใหม่" + พรีฟิลจากห้องแชท ────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<Partial<CustomerFormData> | null>(null);
  const [linkAfterCreate, setLinkAfterCreate] = useState<{ roomId: string } | null>(null);

  /**
   * พรีฟิล + เปิดโมดัลเมื่อเข้ามาจากปุ่ม "สร้างลูกค้าจากแชทนี้"
   * params: `?new=1&name=<displayName>&fromRoomId=<roomId>`
   *
   * 🔴 นี่คือ **ผู้เขียน URL ตอน mount ตัวเดียว** ของหน้านี้ (deps ว่างโดยเจตนา)
   * และเขียนด้วย updater ที่ copy `prev` ⇒ ไม่ทับ `?zone=` หรือพารามิเตอร์ตัวกรอง
   * ที่ hook เพิ่งเขียน (เคยเป็นบั๊ก: `setSearchParams({...})` ล้าง query ทั้งเส้น)
   */
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const prefillName = searchParams.get('name') ?? '';
    const fromRoomId = searchParams.get('fromRoomId');
    if (prefillName) setPrefill(splitDisplayName(prefillName));
    if (fromRoomId) setLinkAfterCreate({ roomId: fromRoomId });
    setIsModalOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        next.delete('name');
        next.delete('fromRoomId');
        return next;
      },
      { replace: true },
    );
  }, []);

  const handleCreated = async (created: { id: string }) => {
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    if (linkAfterCreate?.roomId) {
      try {
        await api.patch(`/staff-chat/rooms/${linkAfterCreate.roomId}/customer`, {
          customerId: created.id,
        });
        queryClient.invalidateQueries({ queryKey: ['chat-room', linkAfterCreate.roomId] });
        toast.success('ผูกลูกค้ากับแชทแล้ว');
        setLinkAfterCreate(null);
        navigate('/inbox');
        return;
      } catch (err) {
        toast.error(`ผูกลูกค้ากับแชทไม่สำเร็จ: ${getErrorMessage(err)}`);
      }
    }
    navigate(`/customers/${created.id}`);
  };

  // ── ลบ ────────────────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<AnyCustomerRow | null>(null);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(isBuyers ? 'ลบลูกค้าสำเร็จ' : 'ลบรายชื่อสำเร็จ');
      setDeleteTarget(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const copyValue = useCallback(
    (value: string, label: string) => {
      copy(value);
      toast.success(`คัดลอก${label}แล้ว`);
    },
    [copy],
  );

  // ── คอลัมน์ ───────────────────────────────────────────────────────────────────
  const customerColumns = useMemo(
    () =>
      buildCustomerColumns({
        isOwner,
        isOwnerOrManager,
        canViewSalary,
        canOpenChat,
        onDelete: setDeleteTarget,
        onCopy: copyValue,
        navigate,
      }),
    [isOwner, isOwnerOrManager, canViewSalary, canOpenChat, copyValue, navigate],
  );

  const prospectColumns = useMemo(
    () =>
      buildProspectColumns({
        isOwner,
        isOwnerOrManager,
        canOpenChat,
        canCreateSale,
        onDelete: setDeleteTarget,
        onCopy: copyValue,
        navigate,
      }),
    [isOwner, isOwnerOrManager, canOpenChat, canCreateSale, copyValue, navigate],
  );

  // ── ส่งออก Excel ──────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportCustomers({
        view,
        params: buildParams(1, 50),
        flags: { isOwnerOrManager, canViewSalary },
      });
    } finally {
      setIsExporting(false);
    }
  };

  // ── การ์ด KPI ที่กำลังถูกเลือก ────────────────────────────────────────────────
  const activeKpiKey = useMemo(() => {
    const specs = isBuyers ? customerKpiCards() : prospectKpiCards();
    const current: Record<string, string> = isBuyers
      ? { purchase: q.purchase, state: q.state, bought: q.bought }
      : { contacted: q.contacted, precheck: q.precheck, source: q.source };
    const match = specs.find(
      (spec) =>
        spec.key !== 'all' &&
        Object.entries(spec.params).every(([key, value]) => (current[key] ?? '') === value),
    );
    if (match) return match.key;
    const anyActive = Object.values(current).some(Boolean);
    return anyActive ? '' : 'all';
  }, [isBuyers, q.purchase, q.state, q.bought, q.contacted, q.precheck, q.source]);

  const rows: AnyCustomerRow[] = isBuyers
    ? (customerResult?.data ?? [])
    : (prospectResult?.data ?? []);

  /**
   * `sort` จาก hook ถือ **คีย์ของ API** (`contractCount`) แต่ DataTable รู้จักแต่
   * **คีย์คอลัมน์** (`purchase`) ⇒ แปลงสองทางที่นี่ที่เดียวด้วย `toColumnSort`/`toApiSort`
   * (ไม่แปลง = กดหัวคอลัมน์ที่ key ≠ sortKey แล้วการเรียงที่ตั้งไว้หายทั้งหมด)
   */
  const activeColumns: readonly SortableColumn[] = isBuyers ? customerColumns : prospectColumns;
  const tableSort = useMemo(() => toColumnSort(activeColumns, sort), [activeColumns, sort]);
  const handleSortChange = useCallback(
    (next: { key: string; direction: 'asc' | 'desc' } | null) =>
      setSort(toApiSort(activeColumns, next)),
    [activeColumns, setSort],
  );

  const sortLabel = useMemo(() => {
    if (!sort) return null;
    const columns = isBuyers ? customerColumns : prospectColumns;
    const hit = columns.find((c) => (c.sortKey ?? c.key) === sort.key);
    if (!hit) return null;
    // ทิศทางพูดต่อชนิดคอลัมน์ — ชื่อไม่มี "ใหม่ → เก่า" (คีย์ที่ไม่รู้จัก = ไม่บอกทิศ)
    const direction = sortDirectionLabel(sort.key, sort.direction);
    return `เรียงตาม${hit.label}${direction ? ` ${direction}` : ''}`;
  }, [sort, isBuyers, customerColumns, prospectColumns]);

  const summaryNode = (
    <span className="text-xs leading-snug text-muted-foreground">
      แสดง {rows.length.toLocaleString()} จาก {total.toLocaleString()} ราย
      {sortLabel ? ` · ${sortLabel}` : ''}
    </span>
  );

  return (
    <div>
      <PageHeader
        title="ลูกค้า"
        subtitle={`ซื้อกับเราแล้ว ${(viewCounts?.customers ?? 0).toLocaleString()} ราย · ผู้สนใจอีก ${(viewCounts?.prospects ?? 0).toLocaleString()} ราย`}
        action={
          <div className="flex gap-2">
            {/* D1.3.3.1 — ซ่อนปุ่มส่งออกเมื่อ OWNER ปิด export_enabled */}
            {exportEnabled && (
              <button
                onClick={handleExport}
                disabled={isExporting || q.isLoading || q.isError}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
              >
                <Download className="size-4" />
                ส่งออก Excel
              </button>
            )}
            {/* ซ่อนจากบทบาทที่ `POST /customers` ไม่รับ (ผจก.การเงิน / ฝ่ายบัญชี)
                ปักไว้ที่ config/__tests__/cta-reachability.test.ts */}
            {canCreateCustomer && (
              <button
                onClick={() => setIsModalOpen(true)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {isBuyers ? '+ เพิ่มลูกค้าใหม่' : '+ เพิ่มผู้สนใจใหม่'}
              </button>
            )}
          </div>
        }
      />

      <CustomerViewSwitch view={view} setView={setView} counts={viewCounts} />

      <CustomerKpiCards
        view={view}
        summary={summary}
        activeKey={activeKpiKey}
        onPick={setFilters}
      />

      {isBuyers ? (
        <CustomerFilterBar
          search={q.search}
          setSearch={q.setSearch}
          purchase={q.purchase}
          state={q.state}
          bought={q.bought}
          tier={q.tier}
          branchId={q.branchId}
          branches={q.branches}
          canFilterBranch={q.canFilterBranch}
          setFilters={setFilters}
        />
      ) : (
        <ProspectFilterBar
          search={q.search}
          setSearch={q.setSearch}
          source={q.source}
          precheck={q.precheck}
          tag={q.tag}
          contacted={q.contacted}
          owner={q.owner}
          staff={q.staff}
          setFilters={setFilters}
        />
      )}

      <Card>
        <CardContent className="p-0">
          {isBuyers ? (
            <CustomerListTable<CustomerRow>
              view={view}
              columns={customerColumns}
              rows={rows as CustomerRow[]}
              isLoading={q.isLoading}
              isError={q.isError}
              error={q.error}
              onRetry={q.refetch}
              sort={tableSort}
              onSortChange={handleSortChange}
              onRowClick={(row) => navigate(`/customers/${row.id}`)}
              emptyMessage="ไม่พบลูกค้า"
              hasFilters={hasActiveFilters}
              onClearFilters={q.clearFilters}
              summaryNode={summaryNode}
              pagination={{ page, totalPages, total, onPageChange: setPage }}
            />
          ) : (
            <CustomerListTable<ProspectRow>
              view={view}
              columns={prospectColumns}
              rows={rows as ProspectRow[]}
              isLoading={q.isLoading}
              isError={q.isError}
              error={q.error}
              onRetry={q.refetch}
              sort={tableSort}
              onSortChange={handleSortChange}
              onRowClick={(row) => navigate(`/customers/${row.id}`)}
              emptyMessage="ไม่พบผู้สนใจ"
              hasFilters={hasActiveFilters}
              onClearFilters={q.clearFilters}
              summaryNode={summaryNode}
              pagination={{ page, totalPages, total, onPageChange: setPage }}
            />
          )}
        </CardContent>
      </Card>

      <CustomerCreateDialog
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open);
          // ปิดแล้วล้างค่าที่มากับ ?new=1 — กดรอบถัดไปต้องได้ฟอร์มเปล่า ไม่ผูกห้องเก่า
          if (!open) {
            setPrefill(null);
            setLinkAfterCreate(null);
          }
        }}
        initialValues={prefill ?? undefined}
        onCreated={handleCreated}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={isBuyers ? 'ลบลูกค้า' : 'ลบรายชื่อ'}
        description={
          deleteTarget
            ? `ต้องการลบ "${deleteTarget.name}" ใช่หรือไม่? การลบจะไม่สามารถกู้คืนได้จากหน้าจอ หากมีสัญญาที่ยังเปิดอยู่จะไม่สามารถลบได้`
            : ''
        }
        confirmLabel="ลบ"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}

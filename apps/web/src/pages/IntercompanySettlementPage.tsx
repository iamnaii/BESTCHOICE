import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PendingTab } from './interco/PendingTab';
import { BatchesTab } from './interco/BatchesTab';
import { CreateBatchDialog } from './interco/CreateBatchDialog';
import { BatchDetailSheet } from './interco/BatchDetailSheet';
import { AgingTab } from './interco/AgingTab';
import { ReconcileTab } from './interco/ReconcileTab';
import { AGING_DEFAULT_THRESHOLD_DAYS } from './interco/types';
import type {
  BatchListResponse,
  InterCoBatchStatus,
  PendingResponse,
  ReconcileFindingsResponse,
  ReconcileRunResponse,
  ShopReceivableAgingResponse,
} from './interco/types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — รอบจ่าย batch (rebuild ของ
 * `/accounting/intercompany`, replaces the old single-transaction settle
 * flow). 2 แท็บ per spec §8:
 *   - "รอจ่าย": คิวสัญญาค้างจ่าย (GL lens) + สร้างรอบจ่าย
 *   - "รอบจ่าย": รายการ batch ทุกสถานะ + maker-checker actions
 *
 * Old page called `/accounting/intercompany/balance` +
 * `/accounting/intercompany/settle` + `/inter-company/aging` (per-transaction
 * settlement, no batching, no maker-checker) — retired server-side (plan
 * Task 5: `settle` now answers 410 Gone) and fully replaced here by the
 * `/interco-settlement/*` endpoints (Task 1-5, already merged on this branch).
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §8
 */
export default function IntercompanySettlementPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'batches' | 'aging' | 'reconcile'>('pending');
  const [lastRun, setLastRun] = useState<ReconcileRunResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRecallIds, setSelectedRecallIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InterCoBatchStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const pendingQuery = useQuery<PendingResponse>({
    queryKey: ['interco-pending'],
    queryFn: async () => (await api.get('/interco-settlement/pending')).data,
    enabled: tab === 'pending',
    staleTime: 15_000,
  });

  const batchesQuery = useQuery<BatchListResponse>({
    queryKey: ['interco-batches', statusFilter, page, limit],
    queryFn: async () =>
      (
        await api.get('/interco-settlement/batches', {
          params: { status: statusFilter, page, limit },
        })
      ).data,
    enabled: tab === 'batches',
    staleTime: 15_000,
  });

  // ยอด/อายุเปลี่ยนตาม batch lifecycle (approve/reverse ล้าง-คืน deduction)
  const agingQuery = useQuery<ShopReceivableAgingResponse>({
    queryKey: ['interco-aging'],
    queryFn: async () => (await api.get('/interco-settlement/shop-receivable-aging')).data,
    enabled: tab === 'aging',
    staleTime: 15_000,
  });

  // Phase 5 Task 5 ข้อ 1 — คู่เจ้าหนี้ไม่ตรง + ยอดติดลบ (สองมุมที่แท็บอายุกรองออก
  // โดยโครงสร้าง จึงต้องมีหน้าจอของตัวเอง)
  const reconcileQuery = useQuery<ReconcileFindingsResponse>({
    queryKey: ['interco-reconcile-findings'],
    queryFn: async () => (await api.get('/interco-settlement/reconcile-findings')).data,
    enabled: tab === 'reconcile',
    staleTime: 15_000,
  });

  // ข้อ 4 — สั่งรันกระทบยอดเอง (เรียก tick() ตัวเดียวกับ cron รายเดือน: dedup
  // Todo ชุดเดิม + kill switch ตัวเดิม). ไม่แตะ GL — รายงานอย่างเดียว
  const runReconcile = useMutation({
    mutationFn: async () =>
      (await api.post('/interco-settlement/reconcile/run')).data as ReconcileRunResponse,
    onSuccess: (data) => {
      setLastRun(data);
      // `failed` มาก่อน `enabled` เสมอ — tick() ไม่ throw (doctrine) จึงรายงาน
      // ความล้มเหลวผ่านฟิลด์นี้ ไม่ใช่ผ่าน error path ของ mutation
      if (data.failed) {
        toast.error('กระทบยอดไม่สำเร็จ — ตรวจไม่จบรอบ ระบบบันทึกข้อผิดพลาดไว้แล้ว ลองใหม่อีกครั้ง');
      } else if (!data.enabled) {
        toast.error('การกระทบยอดถูกปิดไว้ (interco_reconcile_enabled) — ยังไม่ได้ตรวจอะไรเลย');
      } else if (data.total === 0) {
        toast.success('กระทบยอดแล้ว — ตรงทุกรายการ');
      } else {
        toast.warning(`กระทบยอดแล้ว — พบ ${data.total} รายการไม่ตรง`);
      }
      queryClient.invalidateQueries({ queryKey: ['interco-reconcile-findings'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'สั่งรันกระทบยอดไม่สำเร็จ';
      toast.error(message);
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['interco-pending'] });
    queryClient.invalidateQueries({ queryKey: ['interco-batches'] });
    queryClient.invalidateQueries({ queryKey: ['interco-aging'] });
    queryClient.invalidateQueries({ queryKey: ['interco-reconcile-findings'] });
  };

  const pending = pendingQuery.data?.pending ?? [];
  const recalls = pendingQuery.data?.recalls ?? [];
  const selectedContracts = pending.filter((p) => selectedIds.has(p.contractId));
  const selectedRecalls = recalls.filter((r) => selectedRecallIds.has(r.contractId));

  const toggleSelect = (contractId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contractId)) next.delete(contractId);
      else next.add(contractId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === pending.length ? new Set() : new Set(pending.map((p) => p.contractId)),
    );
  };

  const toggleRecall = (contractId: string) => {
    setSelectedRecallIds((prev) => {
      const next = new Set(prev);
      if (next.has(contractId)) next.delete(contractId);
      else next.add(contractId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="จ่ายให้หน้าร้าน (Inter-co)"
        subtitle="รวมสัญญาเป็นรอบจ่าย → อนุมัติ 2 ขั้น (maker-checker) → ลงบัญชี FINANCE ↔ SHOP แบบ atomic"
        icon={<ArrowRightLeft className="h-6 w-6" />}
      />

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'pending' | 'batches' | 'aging' | 'reconcile')}
      >
        <TabsList variant="line" size="md">
          <TabsTrigger value="pending">รอจ่าย</TabsTrigger>
          <TabsTrigger value="batches">รอบจ่าย</TabsTrigger>
          <TabsTrigger value="aging">อายุลูกหนี้หน้าร้าน</TabsTrigger>
          <TabsTrigger value="reconcile">กระทบยอด</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <PendingTab
            pending={pending}
            recalls={recalls}
            reconcile={pendingQuery.data?.reconcile}
            isLoading={pendingQuery.isLoading}
            isError={pendingQuery.isError}
            error={pendingQuery.error}
            onRetry={() => pendingQuery.refetch()}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
            onToggleAll={toggleSelectAll}
            selectedRecallIds={selectedRecallIds}
            onToggleRecall={toggleRecall}
            onCreateClick={() => setCreateOpen(true)}
          />
        </TabsContent>

        <TabsContent value="batches">
          <BatchesTab
            data={batchesQuery.data}
            isLoading={batchesQuery.isLoading}
            isError={batchesQuery.isError}
            error={batchesQuery.error}
            onRetry={() => batchesQuery.refetch()}
            statusFilter={statusFilter}
            onStatusFilterChange={(s) => {
              setStatusFilter(s);
              setPage(1);
            }}
            page={page}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(l) => {
              setLimit(l);
              setPage(1);
            }}
            onRowClick={setDetailBatchId}
          />
        </TabsContent>
        <TabsContent value="aging">
          <AgingTab
            data={agingQuery.data}
            thresholdDays={AGING_DEFAULT_THRESHOLD_DAYS}
            isLoading={agingQuery.isLoading}
            isError={agingQuery.isError}
            error={agingQuery.error}
            onRetry={() => agingQuery.refetch()}
          />
        </TabsContent>
        <TabsContent value="reconcile">
          <ReconcileTab
            data={reconcileQuery.data}
            isLoading={reconcileQuery.isLoading}
            isError={reconcileQuery.isError}
            error={reconcileQuery.error}
            onRetry={() => reconcileQuery.refetch()}
            onRun={() => runReconcile.mutate()}
            isRunning={runReconcile.isPending}
            lastRun={lastRun}
          />
        </TabsContent>
      </Tabs>

      <CreateBatchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        selectedContracts={selectedContracts}
        selectedRecalls={selectedRecalls}
        onCreated={(batchId) => {
          setSelectedIds(new Set());
          setSelectedRecallIds(new Set());
          invalidateAll();
          // Jump straight to the new batch's detail — the maker's next step
          // is almost always "submit for approval" (or attach a slip first).
          setTab('batches');
          setDetailBatchId(batchId);
        }}
      />

      <BatchDetailSheet
        batchId={detailBatchId}
        onClose={() => setDetailBatchId(null)}
        onChanged={invalidateAll}
      />
    </div>
  );
}

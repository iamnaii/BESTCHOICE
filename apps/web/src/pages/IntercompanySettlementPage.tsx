import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PendingTab } from './interco/PendingTab';
import { BatchesTab } from './interco/BatchesTab';
import { CreateBatchDialog } from './interco/CreateBatchDialog';
import { BatchDetailSheet } from './interco/BatchDetailSheet';
import type { BatchListResponse, InterCoBatchStatus, PendingResponse } from './interco/types';

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
  const [tab, setTab] = useState<'pending' | 'batches'>('pending');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['interco-pending'] });
    queryClient.invalidateQueries({ queryKey: ['interco-batches'] });
  };

  const pending = pendingQuery.data?.pending ?? [];
  const selectedContracts = pending.filter((p) => selectedIds.has(p.contractId));

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="จ่ายให้หน้าร้าน (Inter-co)"
        subtitle="รวมสัญญาเป็นรอบจ่าย → อนุมัติ 2 ขั้น (maker-checker) → ลงบัญชี FINANCE ↔ SHOP แบบ atomic"
        icon={<ArrowRightLeft className="h-6 w-6" />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'batches')}>
        <TabsList variant="line" size="md">
          <TabsTrigger value="pending">รอจ่าย</TabsTrigger>
          <TabsTrigger value="batches">รอบจ่าย</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <PendingTab
            pending={pending}
            reconcile={pendingQuery.data?.reconcile}
            isLoading={pendingQuery.isLoading}
            isError={pendingQuery.isError}
            error={pendingQuery.error}
            onRetry={() => pendingQuery.refetch()}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
            onToggleAll={toggleSelectAll}
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
      </Tabs>

      <CreateBatchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        selectedContracts={selectedContracts}
        onCreated={(batchId) => {
          setSelectedIds(new Set());
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

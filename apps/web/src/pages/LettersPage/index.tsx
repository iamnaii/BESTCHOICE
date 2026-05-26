import { useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useLettersList } from './hooks/useLettersList';
import LetterTabs from './components/LetterTabs';
import LetterFiltersBar from './components/LetterFiltersBar';
import LetterTable from './components/LetterTable';
import LetterBulkActionsBar from './components/LetterBulkActionsBar';
import BulkPrintDialog from './components/BulkPrintDialog';
import BulkDispatchDialog from './components/BulkDispatchDialog';
import ExportExcelButton from './components/ExportExcelButton';
import LetterDispatchDialog from '@/pages/CollectionsPage/components/LetterDispatchDialog';
import LetterPdfPreviewDialog from '@/pages/CollectionsPage/components/LetterPdfPreviewDialog';
import { useLetterActions } from '@/pages/CollectionsPage/hooks/useLetterActions';
import type { LetterRow, LetterStatus, LettersListFilters } from './types';

const CROSS_BRANCH_ROLES = new Set(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']);
const CANCEL_ROLES = new Set(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER']);

export default function LettersPage() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canSelectBranch = CROSS_BRANCH_ROLES.has(role);
  const canCancel = CANCEL_ROLES.has(role);

  const [activeStatus, setActiveStatus] = useState<LetterStatus>('PENDING_DISPATCH');
  const [filters, setFilters] = useState<Omit<LettersListFilters, 'status' | 'page' | 'limit'>>({});
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [previewRow, setPreviewRow] = useState<LetterRow | null>(null);
  const [dispatchRow, setDispatchRow] = useState<LetterRow | null>(null);
  const [bulkPrintOpen, setBulkPrintOpen] = useState(false);
  const [bulkDispatchOpen, setBulkDispatchOpen] = useState(false);

  const fullFilters: LettersListFilters = { ...filters, status: activeStatus, page, limit: 50 };
  const listQuery = useLettersList(fullFilters);

  const stripUndefined = (obj: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== '') out[k] = v;
    }
    return out;
  };

  const countsQuery = useQuery({
    queryKey: ['letters-counts', filters],
    queryFn: async () => {
      const { data } = await api.get<Record<LetterStatus, number>>('/overdue/letters/counts', {
        params: stripUndefined(filters as Record<string, unknown>),
      });
      return data;
    },
  });

  const branchesQuery = useQuery({
    queryKey: ['branches-list'],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string }>>('/branches');
      return data;
    },
    enabled: canSelectBranch,
  });

  const actions = useLetterActions();

  // revertUndeliverable is handled via undo toast inside useLetterActions/markUndeliverable.
  // For explicit revert (e.g. from the table action button), we call the API directly.
  const qc = useQueryClient();
  const revertUndeliverable = useMutation({
    mutationFn: async (letterId: string) => {
      const { data } = await api.post(`/overdue/letters/${letterId}/revert-undeliverable`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['letters'] });
    },
  });

  const rows = (listQuery.data?.data ?? []) as LetterRow[];

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds],
  );

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleToggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(rows.map((r) => r.id)) : new Set());
  };

  const handleTabChange = (s: LetterStatus) => {
    setActiveStatus(s);
    setSelectedIds(new Set());
    setPage(1);
  };

  return (
    <div className="p-4 pb-20 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Mail className="size-5" /> จัดการจดหมาย
        </h1>
        <ExportExcelButton filters={fullFilters} />
      </div>

      <LetterTabs
        active={activeStatus}
        counts={countsQuery.data ?? {}}
        onChange={handleTabChange}
      />

      <LetterFiltersBar
        value={filters}
        onChange={(next) => {
          setFilters(next);
          setSelectedIds(new Set());
          setPage(1);
        }}
        branches={branchesQuery.data ?? []}
        canSelectBranch={canSelectBranch}
      />

      {listQuery.isLoading ? (
        <div className="p-8 text-center text-muted-foreground">กำลังโหลด...</div>
      ) : listQuery.isError ? (
        <div className="p-8 text-center text-destructive">เกิดข้อผิดพลาด</div>
      ) : (
        <LetterTable
          rows={rows}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          onToggleAll={handleToggleAll}
          status={activeStatus}
          canCancel={canCancel}
          onPreview={setPreviewRow}
          onDispatch={setDispatchRow}
          onMarkDelivered={(r) => actions.markDelivered.mutate(r.id)}
          onMarkUndeliverable={(r) =>
            actions.markUndeliverable.mutate({ letterId: r.id, reason: 'ตีกลับจากไปรษณีย์' })
          }
          onRevertUndeliverable={(r) => revertUndeliverable.mutate(r.id)}
          onCancel={(r) =>
            actions.cancel.mutate({ letterId: r.id, reason: 'ยกเลิกตามคำสั่ง' })
          }
        />
      )}

      <LetterBulkActionsBar
        status={activeStatus}
        count={selectedRows.length}
        canCancel={canCancel}
        onBulkPrint={() => setBulkPrintOpen(true)}
        onBulkDispatch={() => setBulkDispatchOpen(true)}
        onBulkUndeliverable={async () => {
          for (const r of selectedRows) {
            await actions.markUndeliverable.mutateAsync({
              letterId: r.id,
              reason: 'ตีกลับ (bulk)',
            });
          }
          setSelectedIds(new Set());
        }}
        onBulkCancel={async () => {
          if (!confirm(`ยืนยันยกเลิก ${selectedRows.length} ฉบับ?`)) return;
          for (const r of selectedRows) {
            await actions.cancel.mutateAsync({ letterId: r.id, reason: 'ยกเลิก (bulk)' });
          }
          setSelectedIds(new Set());
        }}
        onClear={() => setSelectedIds(new Set())}
      />

      {previewRow && (
        <LetterPdfPreviewDialog
          open={!!previewRow}
          pdfUrl={previewRow.pdfUrl ?? null}
          title={`ตัวอย่าง PDF — ${previewRow.letterNumber}`}
          onClose={() => setPreviewRow(null)}
        />
      )}
      {dispatchRow && (
        <LetterDispatchDialog
          open={!!dispatchRow}
          letter={dispatchRow}
          initialMode={dispatchRow.pdfUrl ? 'dispatch' : 'generate'}
          onClose={() => setDispatchRow(null)}
        />
      )}
      {bulkPrintOpen && (
        <BulkPrintDialog
          open={bulkPrintOpen}
          rows={selectedRows}
          onClose={() => {
            setBulkPrintOpen(false);
            setSelectedIds(new Set());
          }}
        />
      )}
      {bulkDispatchOpen && (
        <BulkDispatchDialog
          open={bulkDispatchOpen}
          rows={selectedRows}
          onClose={() => {
            setBulkDispatchOpen(false);
            setSelectedIds(new Set());
          }}
        />
      )}
    </div>
  );
}

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import QueryBoundary from '@/components/QueryBoundary';
import ContractCard from '../components/ContractCard';
import BulkActionBar from '../components/BulkActionBar';
import { useCollectionsQueue } from '../hooks/useCollectionsQueue';
import { useBulkSelection } from '../hooks/useBulkSelection';
import type { ContractRow } from '../types';

const LIMIT = 50;

function CardSkeleton() {
  return (
    <div className="flex rounded-xl border border-border/50 bg-card overflow-hidden h-[148px] animate-pulse">
      <div className="w-1 shrink-0 bg-muted" />
      <div className="flex-1 p-4 space-y-2">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-3 w-20 rounded bg-muted" />
        <div className="mt-3 h-3 w-32 rounded bg-muted" />
      </div>
    </div>
  );
}

interface Props {
  search: string;
  branchId: string;
  onLogContact: (c: ContractRow) => void;
  onOpen360?: (c: ContractRow) => void;
  onSendLine?: (c: ContractRow) => void;
}

export default function QueueTab({ search, branchId, onLogContact, onOpen360, onSendLine }: Props) {
  const [page, setPage] = useState(1);
  const sel = useBulkSelection();
  const debouncedSearch = useDebounce(search, 300);

  const q = useCollectionsQueue({
    tab: 'today',
    search: debouncedSearch,
    branchId,
    page,
    limit: LIMIT,
    enabled: true,
  });

  const total = q.data?.total ?? 0;
  // C1 fix: search is now server-side via useCollectionsQueue → /overdue/queue
  // so the returned page is already filtered. No client-side narrowing needed;
  // previously the filter only matched the current page, missing hits past it.
  const filtered = q.data?.data ?? [];

  return (
    <QueryBoundary
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      onRetry={q.refetch}
      loadingFallback={
        <div className="space-y-2">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      }
    >
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-success/30 bg-success/5 p-10 text-center">
          <CheckCircle2 className="size-10 mx-auto mb-3 text-success" />
          <div className="text-sm font-medium text-success leading-snug">
            ไม่มีคิวติดตามวันนี้
          </div>
          <div className="text-xs text-muted-foreground mt-1 leading-snug">
            กลับมาพรุ่งนี้เช้า
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {filtered.map((row) => (
              <ContractCard
                key={row.id}
                contract={row}
                onLogContact={onLogContact}
                onOpen360={onOpen360}
                onSendLine={onSendLine}
                selected={sel.isSelected(row.id)}
                onToggleSelect={sel.toggle}
              />
            ))}
          </div>

          {total > LIMIT && (
            <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
              <span className="leading-snug">
                หน้า {page}/{Math.ceil(total / LIMIT)} · ทั้งหมด {total} รายการ
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 rounded border border-input hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  ก่อนหน้า
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * LIMIT >= total}
                  className="px-3 py-1 rounded border border-input hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <BulkActionBar selectedIds={sel.selectedIds} onClear={sel.clear} />
    </QueryBoundary>
  );
}

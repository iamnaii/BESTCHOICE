import { useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import QueryBoundary from '@/components/QueryBoundary';
import ContractCard from '../components/ContractCard';
import BulkActionBar from '../components/BulkActionBar';
import TruncatedBanner from '../components/TruncatedBanner';
import FilterChipsBar from '../components/FilterChipsBar';
import FilterDrawer from '../components/FilterDrawer';
import { useCollectionsQueue } from '../hooks/useCollectionsQueue';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { useQueueFilter } from '../hooks/useQueueFilter';
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
  onSkipTrace?: (c: ContractRow) => void;
}

export default function FollowUpTab({
  search,
  branchId,
  onLogContact,
  onOpen360,
  onSendLine,
  onSkipTrace,
}: Props) {
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const sel = useBulkSelection();
  const debouncedSearch = useDebounce(search, 300);
  const [filter, setFilter, resetFilter] = useQueueFilter('follow-up');

  const q = useCollectionsQueue({
    tab: 'followup',
    search: debouncedSearch,
    branchId,
    page,
    limit: LIMIT,
    enabled: true,
    filter,
  });

  const total = q.data?.total ?? 0;
  const rows = q.data?.data ?? [];
  const truncated = q.data?.truncated ?? false;

  const openFilter = () => setFilterOpen(true);
  const filtered = rows;

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
      <FilterChipsBar
        filter={filter}
        setFilter={setFilter}
        reset={resetFilter}
        onOpenFilter={openFilter}
        resultCount={rows.length}
        totalCount={total}
      />
      {truncated && <TruncatedBanner onOpenFilter={openFilter} />}

      {filtered.length === 0 ? (
        filter.showSkipTracing ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <div className="text-sm font-medium text-muted-foreground leading-snug">
              ไม่มีใครต้องหาเบอร์ใหม่
            </div>
            <div className="text-xs text-muted-foreground mt-1 leading-snug">
              ทุกคนมีเบอร์ติดต่อที่ถูกต้องแล้ว
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-10 text-center">
            <div className="text-sm font-medium text-primary leading-snug">
              ไม่มีใครที่ต้องตามต่อ
            </div>
            <div className="text-xs text-muted-foreground mt-1 leading-snug">
              ทุกคนติดต่อได้หมดแล้ว
            </div>
          </div>
        )
      ) : (
        <>
          {/* Context banner */}
          {!filter.showSkipTracing && (
          <div className="mb-4 rounded-lg bg-warning/5 border border-warning/20 p-3 text-xs text-warning leading-snug">
            <strong>ตามต่อ:</strong>{' '}
            ลูกค้าที่เคยโทรไปแล้วแต่ไม่รับ — ถ้าไม่รับครั้งต่อไปครบ 3 ครั้ง
            ระบบจะเสนอล็อคเครื่องอัตโนมัติ
          </div>
          )}

          <div className="space-y-2">
            {filtered.map((row) =>
              row.noAnswerCount === 2 ? (
                <div key={row.id} className="ring-2 ring-destructive/40 rounded-xl">
                  <ContractCard
                    contract={row}
                    onLogContact={onLogContact}
                    onOpen360={onOpen360}
                    onSendLine={onSendLine}
                    onSkipTrace={onSkipTrace}
                    selected={sel.isSelected(row.id)}
                    onToggleSelect={sel.toggle}
                  />
                </div>
              ) : (
                <ContractCard
                  key={row.id}
                  contract={row}
                  onLogContact={onLogContact}
                  onOpen360={onOpen360}
                  onSendLine={onSendLine}
                  onSkipTrace={onSkipTrace}
                  selected={sel.isSelected(row.id)}
                  onToggleSelect={sel.toggle}
                />
              ),
            )}
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
      <BulkActionBar selectedIds={sel.selectedIds} onClear={sel.clear} contracts={rows} />
      <FilterDrawer
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filter={filter}
        onApply={(next) => {
          setFilter(next);
          setPage(1);
        }}
        onReset={() => {
          resetFilter();
          setPage(1);
        }}
        liveCount={total}
      />
    </QueryBoundary>
  );
}

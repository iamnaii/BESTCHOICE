import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PartyPopper, Phone } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { isToday } from '../utils/today';
import { useCollectionsKeyboard } from '@/hooks/useCollectionsKeyboard';
import QueryBoundary from '@/components/QueryBoundary';
import ContractCard from '../components/ContractCard';
import BulkActionBar from '../components/BulkActionBar';
import TruncatedBanner from '../components/TruncatedBanner';
import FilterChipsBar from '../components/FilterChipsBar';
import FilterDrawer from '../components/FilterDrawer';
import KeyboardShortcutsOverlay from '../components/KeyboardShortcutsOverlay';
import SnoozeDialog from '../components/SnoozeDialog';
import { useCollectionsQueue } from '../hooks/useCollectionsQueue';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { useQueueFilter } from '../hooks/useQueueFilter';
import { useUnsnoozeContract } from '../hooks/useSnooze';
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
  hideContactedToday?: boolean;
  onLogContact: (c: ContractRow) => void;
  onOpen360?: (c: ContractRow) => void;
  onSendLine?: (c: ContractRow) => void;
  onSkipTrace?: (c: ContractRow) => void;
  onSwitchTab?: (tab: 'today' | 'promise' | 'approval' | 'analytics' | 'all') => void;
}

export default function QueueTab({
  search,
  branchId,
  hideContactedToday = false,
  onLogContact,
  onOpen360,
  onSendLine,
  onSkipTrace,
  onSwitchTab,
}: Props) {
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const sel = useBulkSelection();
  const debouncedSearch = useDebounce(search, 300);
  const [filter, setFilter, resetFilter] = useQueueFilter('queue');
  const [snoozeTarget, setSnoozeTarget] = useState<ContractRow | null>(null);
  const unsnooze = useUnsnoozeContract();

  const q = useCollectionsQueue({
    tab: 'today',
    search: debouncedSearch,
    branchId,
    page,
    limit: LIMIT,
    enabled: true,
    filter,
  });

  const total = q.data?.total ?? 0;
  // C1 fix: search is now server-side via useCollectionsQueue → /overdue/queue
  const rawRows = q.data?.data ?? [];
  // Apply client-side "hide contacted today" filter on top of the server result.
  // NOTE: counts below operate on the current page only — backend pagination is
  // unchanged, so for page 2+ the strip reflects "in this view" not the entire queue.
  const rows = useMemo(
    () => (hideContactedToday ? rawRows.filter((r) => !isToday(r.lastCallAt)) : rawRows),
    [rawRows, hideContactedToday],
  );
  const contactedTodayCount = useMemo(
    () => rawRows.filter((r) => isToday(r.lastCallAt)).length,
    [rawRows],
  );
  const remainingCount = rawRows.length - contactedTodayCount;
  const truncated = q.data?.truncated ?? false;

  // Keep focus index within bounds when rows change.
  useEffect(() => {
    if (focusedIndex >= rows.length) setFocusedIndex(0);
  }, [rows.length, focusedIndex]);

  const focusedRow = rows[focusedIndex];

  const { helpOpen, setHelpOpen, waitingForGSecond } = useCollectionsKeyboard({
    onSwitchTab,
    onMoveFocus: (dir) => {
      if (rows.length === 0) return;
      setFocusedIndex((i) => {
        const next = i + dir;
        if (next < 0) return 0;
        if (next >= rows.length) return rows.length - 1;
        return next;
      });
    },
    onOpenFocused: () => focusedRow && onOpen360?.(focusedRow),
    onLineFocused: () => focusedRow && onSendLine?.(focusedRow),
    onCallFocused: () => focusedRow && onLogContact(focusedRow),
    // Payment / snooze / assign actions are wired in their own follow-up tasks.
    onPaymentFocused: () => focusedRow && onOpen360?.(focusedRow),
    onSnoozeFocused: () => focusedRow && setSnoozeTarget(focusedRow),
    onAssignFocused: () => focusedRow && onOpen360?.(focusedRow),
  });

  const openFilter = () => setFilterOpen(true);

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
      {rawRows.length > 0 && (
        <div className="mb-3 flex items-center gap-3 text-sm leading-snug">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-success" />
            <span className="font-semibold tabular-nums">{contactedTodayCount}</span>
            <span className="text-muted-foreground">โทรแล้ววันนี้</span>
          </span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Phone className="size-4 text-muted-foreground" />
            <span className="font-semibold tabular-nums">{remainingCount}</span>
            <span className="text-muted-foreground">เหลือ</span>
          </span>
        </div>
      )}
      {truncated && <TruncatedBanner onOpenFilter={openFilter} />}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-success/30 bg-success/5 p-10 text-center">
          <PartyPopper className="size-10 mx-auto mb-3 text-success" />
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
            {rows.map((row, idx) => (
              <ContractCard
                key={row.id}
                contract={row}
                onLogContact={onLogContact}
                onOpen360={onOpen360}
                onSendLine={onSendLine}
                selected={sel.isSelected(row.id)}
                onToggleSelect={sel.toggle}
                focused={idx === focusedIndex}
                onSnooze={(c) => setSnoozeTarget(c)}
                onUnsnooze={(c) => unsnooze.mutate(c.id)}
                onSkipTrace={onSkipTrace}
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
      <BulkActionBar selectedIds={sel.selectedIds} onClear={sel.clear} contracts={rows} />
      {waitingForGSecond && (
        <div
          className="fixed bottom-4 right-4 z-50 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-mono shadow-lg"
          aria-live="polite"
        >
          G-
        </div>
      )}
      <KeyboardShortcutsOverlay open={helpOpen} onOpenChange={setHelpOpen} />
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
      <SnoozeDialog
        open={!!snoozeTarget}
        onClose={() => setSnoozeTarget(null)}
        contract={
          snoozeTarget
            ? {
                id: snoozeTarget.id,
                contractNumber: snoozeTarget.contractNumber,
                customer: { name: snoozeTarget.customer.name },
              }
            : null
        }
      />
    </QueryBoundary>
  );
}

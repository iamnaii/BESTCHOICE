import { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Phone, Timer } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { formatThaiDateShort } from '@/lib/date';
import { isToday } from '../utils/today';
import QueryBoundary from '@/components/QueryBoundary';
import ContractCard from '../components/ContractCard';
import TruncatedBanner from '../components/TruncatedBanner';
import FilterChipsBar from '../components/FilterChipsBar';
import FilterDrawer from '../components/FilterDrawer';
import BrokenPromiseBanner from '../components/BrokenPromiseBanner';
import { useCollectionsQueue } from '../hooks/useCollectionsQueue';
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

function todayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function thirtyDaysFromNow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

interface GroupedRows {
  today: ContractRow[];
  broken: ContractRow[];
  upcoming: ContractRow[];
}

function groupRows(rows: ContractRow[]): GroupedRows {
  const todayStr = todayDateString();
  const tomorrowStr = tomorrowDateString();
  const limitStr = thirtyDaysFromNow();

  const sorted = [...rows].sort((a, b) => {
    if (!a.settlementDate) return 1;
    if (!b.settlementDate) return -1;
    return a.settlementDate.localeCompare(b.settlementDate);
  });

  const today: ContractRow[] = [];
  const broken: ContractRow[] = [];
  const upcoming: ContractRow[] = [];

  for (const row of sorted) {
    if (!row.settlementDate) {
      upcoming.push(row);
      continue;
    }
    const d = row.settlementDate.split('T')[0];
    if (d < todayStr) {
      broken.push(row);
    } else if (d === todayStr) {
      today.push(row);
    } else if (d >= tomorrowStr && d <= limitStr) {
      upcoming.push(row);
    } else {
      upcoming.push(row);
    }
  }

  return { today, broken, upcoming };
}

/**
 * Task 24 — Cycle countdown banner shown below each promise card.
 * Displays the cycle deadline and remaining days, plus a slot grid.
 */
function PromiseCycleView({ row }: { row: ContractRow }) {
  const hasSlots = (row.slots?.length ?? 0) > 0;
  const hasCycleDeadline = !!row.cycleDeadline;

  if (!hasCycleDeadline && !hasSlots) return null;

  const deadlineDate = row.cycleDeadline ? new Date(row.cycleDeadline) : null;
  const daysLeft = deadlineDate
    ? Math.max(0, Math.ceil((deadlineDate.getTime() - Date.now()) / 86400000))
    : null;

  const deadlineLabel = deadlineDate ? formatThaiDateShort(deadlineDate) : null;

  return (
    <div className="rounded-b-xl border border-t-0 border-border/50 bg-muted/40 px-4 py-2.5 flex flex-col gap-2">
      {/* Cycle deadline row */}
      {hasCycleDeadline && deadlineLabel !== null && daysLeft !== null && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground leading-snug">
          <Timer className="size-3.5 shrink-0" />
          <span>
            เพดานรอบ:{' '}
            <span className="font-medium text-foreground">{deadlineLabel}</span>
            {' · '}
            <span className={daysLeft <= 3 ? 'text-destructive font-semibold' : ''}>
              เหลือ {daysLeft} วัน
            </span>
            {(row.rescheduleCount ?? 0) > 0 && (
              <span className="ml-2 text-muted-foreground">
                · ย้ายนัดแล้ว {row.rescheduleCount} ครั้ง
              </span>
            )}
          </span>
        </div>
      )}

      {/* Slot grid */}
      {hasSlots && (
        <div className="flex gap-1 flex-wrap">
          {row.slots!.map((s) => {
            const status = s.keptAt ? 'kept' : s.brokenAt ? 'broken' : 'pending';
            const tone =
              status === 'kept'
                ? 'bg-success/20 text-success border border-success/30'
                : status === 'broken'
                ? 'bg-destructive/20 text-destructive border border-destructive/30'
                : 'bg-muted text-muted-foreground border border-border';
            const slotDate = formatThaiDateShort(s.settlementDate);
            return (
              <div
                key={s.id}
                className={`px-2 py-0.5 rounded text-xs font-medium leading-snug ${tone}`}
                title={`งวดที่ ${s.slotIndex} — ${slotDate} · ${s.settlementAmount.toLocaleString()} ฿`}
              >
                งวด {s.slotIndex}
              </div>
            );
          })}
        </div>
      )}
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
}

export default function PromiseTab({
  search,
  branchId,
  hideContactedToday = false,
  onLogContact,
  onOpen360,
  onSendLine,
  onSkipTrace,
}: Props) {
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const [filter, setFilter, resetFilter] = useQueueFilter('promise');

  const q = useCollectionsQueue({
    tab: 'promise',
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

  const openFilter = () => setFilterOpen(true);

  const groups = groupRows(rows);
  const isEmpty = rows.length === 0;

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
      <BrokenPromiseBanner />
      {truncated && <TruncatedBanner onOpenFilter={openFilter} />}
      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Calendar className="size-10 mx-auto mb-3 text-muted-foreground" />
          <div className="text-sm font-medium text-foreground leading-snug">
            ไม่มีนัดชำระในช่วงนี้
          </div>
          <div className="text-xs text-muted-foreground mt-1 leading-snug">
            ลูกค้าที่นัดชำระไว้จะปรากฏที่นี่
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {/* เลยนัดแล้ว */}
            {groups.broken.length > 0 && (
              <section>
                <h3 className="text-xs uppercase tracking-wider text-destructive font-semibold mb-2 flex items-center gap-2 leading-snug">
                  <AlertTriangle className="size-3.5" />
                  เลยนัดแล้ว — ต้องตามทันที
                </h3>
                <div className="space-y-2">
                  {groups.broken.map((row) => (
                    <div key={row.id} className="ring-2 ring-destructive/50 rounded-xl overflow-hidden">
                      <ContractCard
                        contract={row}
                        onLogContact={onLogContact}
                        onOpen360={onOpen360}
                        onSendLine={onSendLine}
                        onSkipTrace={onSkipTrace}
                      />
                      <PromiseCycleView row={row} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* วันนี้ครบกำหนดนัด */}
            {groups.today.length > 0 && (
              <section>
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 leading-snug">
                  วันนี้ครบกำหนดนัด
                </h3>
                <div className="space-y-2">
                  {groups.today.map((row) => (
                    <div key={row.id} className="rounded-xl overflow-hidden">
                      <ContractCard
                        contract={row}
                        onLogContact={onLogContact}
                        onOpen360={onOpen360}
                        onSendLine={onSendLine}
                        onSkipTrace={onSkipTrace}
                      />
                      <PromiseCycleView row={row} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* กำลังจะถึง */}
            {groups.upcoming.length > 0 && (
              <section>
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 leading-snug">
                  กำลังจะถึง
                </h3>
                <div className="space-y-2">
                  {groups.upcoming.map((row) => (
                    <div key={row.id} className="rounded-xl overflow-hidden">
                      <ContractCard
                        contract={row}
                        onLogContact={onLogContact}
                        onOpen360={onOpen360}
                        onSendLine={onSendLine}
                        onSkipTrace={onSkipTrace}
                      />
                      <PromiseCycleView row={row} />
                    </div>
                  ))}
                </div>
              </section>
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

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import QueryBoundary from '@/components/QueryBoundary';
import ContractCard from '../components/ContractCard';
import BulkActionBar from '../components/BulkActionBar';
import TruncatedBanner from '../components/TruncatedBanner';
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

interface Props {
  search: string;
  branchId: string;
  onLogContact: (c: ContractRow) => void;
  onOpen360?: (c: ContractRow) => void;
  onSendLine?: (c: ContractRow) => void;
}

export default function PromiseTab({ search, branchId, onLogContact, onOpen360, onSendLine }: Props) {
  const [page, setPage] = useState(1);
  const sel = useBulkSelection();
  const debouncedSearch = useDebounce(search, 300);

  const q = useCollectionsQueue({
    tab: 'promise',
    search: debouncedSearch,
    branchId,
    page,
    limit: LIMIT,
    enabled: true,
  });

  const total = q.data?.total ?? 0;
  const rows = q.data?.data ?? [];
  const truncated = q.data?.truncated ?? false;

  // Task 10 will wire this to a real filter drawer; stub for now.
  const openFilter = () => {};

  // Client-side search filter
  const filtered = debouncedSearch
    ? rows.filter((r) => {
        const term = debouncedSearch.toLowerCase();
        return (
          r.customer.name.toLowerCase().includes(term) ||
          r.contractNumber.toLowerCase().includes(term) ||
          r.customer.phone.toLowerCase().includes(term)
        );
      })
    : rows;

  const groups = groupRows(filtered);
  const isEmpty = filtered.length === 0;

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
      {truncated && <TruncatedBanner onOpenFilter={openFilter} />}
      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <div className="text-4xl mb-3">📅</div>
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
                    <div key={row.id} className="ring-2 ring-destructive/50 rounded-xl">
                      <ContractCard
                        contract={row}
                        onLogContact={onLogContact}
                        onOpen360={onOpen360}
                        onSendLine={onSendLine}
                        selected={sel.isSelected(row.id)}
                        onToggleSelect={sel.toggle}
                      />
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
      <BulkActionBar selectedIds={sel.selectedIds} onClear={sel.clear} />
    </QueryBoundary>
  );
}

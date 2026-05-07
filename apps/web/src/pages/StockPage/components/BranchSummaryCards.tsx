import { BranchSummary } from '../types';

export interface BranchSummaryCardsProps {
  summary: BranchSummary[];
  filterBranch: string;
  setFilterBranch: (branch: string) => void;
}

export function BranchSummaryCards({ summary, filterBranch, setFilterBranch }: BranchSummaryCardsProps) {
  // Hide test branches (name starting with `__`) and inactive branches with zero stock.
  const realBranches = summary.filter((s) => !s.branch.name.startsWith('__'));
  const visible = realBranches.some((s) => s.total > 0)
    ? realBranches.filter((s) => s.total > 0)
    : realBranches;

  if (visible.length === 0) return null;

  const totalStock = visible.reduce((sum, s) => sum + s.inStock, 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {visible.map((s) => {
        const sharePct = totalStock > 0 ? (s.inStock / totalStock) * 100 : 0;
        const isActive = filterBranch === s.branch.id;
        return (
          <button
            key={s.branch.id}
            onClick={() => setFilterBranch(isActive ? '' : s.branch.id)}
            className={`relative overflow-hidden rounded-xl border p-3.5 text-left transition-all group ${
              isActive
                ? 'border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary))]'
                : 'border-border/60 bg-card hover:border-primary/40 hover:bg-accent/30'
            }`}
          >
            {/* Share fill bar */}
            <div
              className={`absolute inset-y-0 left-0 transition-all ${
                isActive ? 'bg-primary/10' : 'bg-muted/50 group-hover:bg-muted'
              }`}
              style={{ width: `${sharePct}%` }}
              aria-hidden
            />
            <div className="relative">
              <div className="text-[13px] font-semibold text-foreground truncate mb-1.5">{s.branch.name}</div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tabular-nums">{s.inStock}</span>
                <span className="text-[11px] text-muted-foreground">/ {s.total} ชิ้น</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1.5">
                <span className="tabular-nums">{s.totalValue.toLocaleString()} ฿</span>
                <span className="tabular-nums">{sharePct.toFixed(0)}%</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

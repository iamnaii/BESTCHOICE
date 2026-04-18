import { BranchSummary } from '../types';

export interface BranchSummaryCardsProps {
  summary: BranchSummary[];
  filterBranch: string;
  setFilterBranch: (branch: string) => void;
}

export function BranchSummaryCards({ summary, filterBranch, setFilterBranch }: BranchSummaryCardsProps) {
  // Hide branches with zero stock so inactive/legacy branches don't clutter the dashboard.
  // Fallback: if every branch has zero, show the full list so user isn't stuck with blank UI.
  const visible = summary.some((s) => s.total > 0)
    ? summary.filter((s) => s.total > 0)
    : summary;

  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {visible.map((s) => (
        <button
          key={s.branch.id}
          onClick={() => setFilterBranch(filterBranch === s.branch.id ? '' : s.branch.id)}
          className={`rounded-xl border p-4 text-left transition-all hover:shadow-card-hover ${
            filterBranch === s.branch.id ? 'border-primary ring-2 ring-primary/20 border-l-[3px] border-l-primary shadow-card' : 'border-border/60 hover:border-border'
          }`}
        >
          <div className="text-sm font-medium text-foreground mb-2">{s.branch.name}</div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>พร้อมขาย: {s.inStock}</span>
            <span>ทั้งหมด: {s.total}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">มูลค่า: {s.totalValue.toLocaleString()} ฿</div>
        </button>
      ))}
    </div>
  );
}

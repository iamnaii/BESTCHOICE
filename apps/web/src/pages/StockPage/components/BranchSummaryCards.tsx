import { BranchSummary } from '../types';

export interface BranchSummaryCardsProps {
  summary: BranchSummary[];
  filterBranch: string;
  setFilterBranch: (branch: string) => void;
}

export function BranchSummaryCards({ summary, filterBranch, setFilterBranch }: BranchSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {summary.map((s) => (
        <button
          key={s.branch.id}
          onClick={() => setFilterBranch(filterBranch === s.branch.id ? '' : s.branch.id)}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filterBranch === s.branch.id ? 'border-primary-500 ring-2 ring-primary-100' : 'hover:border-input'
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

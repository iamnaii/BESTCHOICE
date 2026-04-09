import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { type Branch, type CreditCheckSummary } from './types';

interface CreditCheckFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
  onDateRangeShortcut: (type: 'today' | 'week' | 'month') => void;
  onClearDateRange: () => void;
  branchFilter: string;
  onBranchFilterChange: (v: string) => void;
  isOwner: boolean;
  branches: Branch[];
  summary: CreditCheckSummary | undefined;
}

function avgScoreColor(score: number) {
  if (score >= 60) return 'text-success';
  if (score >= 40) return 'text-amber-700 dark:text-amber-500';
  return 'text-destructive';
}

function avgScoreBg(score: number) {
  if (score >= 60) return 'bg-success/5 dark:bg-success/10 border-success/20';
  if (score >= 40) return 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20';
  return 'bg-destructive/5 dark:bg-destructive/10 border-destructive/20';
}

function avgScoreLabel(score: number) {
  if (score >= 60) return 'text-success';
  if (score >= 40) return 'text-amber-600 dark:text-amber-500';
  return 'text-destructive';
}

export default function CreditCheckFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  onDateRangeShortcut,
  onClearDateRange,
  branchFilter,
  onBranchFilterChange,
  isOwner,
  branches,
  summary,
}: CreditCheckFiltersProps) {
  return (
    <>
      {/* Filter row */}
      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <input
          type="text"
          placeholder="ค้นหาชื่อลูกค้า..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm w-64"
        />
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm"
        >
          <option value="">ทุกสถานะ</option>
          <option value="PENDING">รอวิเคราะห์</option>
          <option value="APPROVED">ผ่าน</option>
          <option value="REJECTED">ไม่ผ่าน</option>
          <option value="MANUAL_REVIEW">ต้องตรวจเพิ่ม</option>
        </select>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <ThaiDateInput
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          />
          <span className="text-sm text-muted-foreground">ถึง</span>
          <ThaiDateInput
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onDateRangeShortcut('today')}
            className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-muted"
          >
            วันนี้
          </button>
          <button
            onClick={() => onDateRangeShortcut('week')}
            className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-muted"
          >
            สัปดาห์นี้
          </button>
          <button
            onClick={() => onDateRangeShortcut('month')}
            className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-muted"
          >
            เดือนนี้
          </button>
          {(startDate || endDate) && (
            <button
              onClick={onClearDateRange}
              className="px-2 py-1.5 text-xs text-destructive border border-destructive/20 rounded-lg hover:bg-destructive/5"
            >
              ล้าง
            </button>
          )}
        </div>

        {/* Branch filter (OWNER only) */}
        {isOwner && branches.length > 0 && (
          <select
            value={branchFilter}
            onChange={(e) => onBranchFilterChange(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-5 lg:gap-7.5 mb-6">
        <div className="bg-card rounded-lg border border-l-[3px] border-l-foreground p-4 hover:shadow-card-hover transition-all">
          <div className="text-xs text-muted-foreground">ทั้งหมด</div>
          <div className="text-xl font-bold">{summary?.totalCount ?? 0}</div>
        </div>
        <div className="bg-success/5 dark:bg-success/10 rounded-lg border border-success/20 border-l-[3px] border-l-success p-4 hover:shadow-card-hover transition-all">
          <div className="text-xs text-success">ผ่าน</div>
          <div className="text-xl font-bold text-success">{summary?.approvedCount ?? 0}</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-lg border border-amber-200 dark:border-amber-500/20 border-l-[3px] border-l-warning p-4 hover:shadow-card-hover transition-all">
          <div className="text-xs text-amber-600 dark:text-amber-500">รอวิเคราะห์ / ตรวจเพิ่ม</div>
          <div className="text-xl font-bold text-amber-700 dark:text-amber-500">
            {summary?.pendingCount ?? 0}
          </div>
        </div>
        <div className="bg-destructive/5 dark:bg-destructive/10 rounded-lg border border-destructive/20 border-l-[3px] border-l-destructive p-4 hover:shadow-card-hover transition-all">
          <div className="text-xs text-destructive">ไม่ผ่าน</div>
          <div className="text-xl font-bold text-destructive">{summary?.rejectedCount ?? 0}</div>
        </div>
        <div
          className={`rounded-lg border p-4 hover:shadow-card-hover transition-all ${summary?.avgScore ? avgScoreBg(summary.avgScore) : 'bg-card'}`}
        >
          <div
            className={`text-xs ${summary?.avgScore ? avgScoreLabel(summary.avgScore) : 'text-muted-foreground'}`}
          >
            คะแนน AI เฉลี่ย
          </div>
          <div className={`text-xl font-bold ${summary?.avgScore ? avgScoreColor(summary.avgScore) : ''}`}>
            {summary?.avgScore ?? '-'}
          </div>
        </div>
      </div>
    </>
  );
}

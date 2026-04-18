import { Search } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  if (score >= 40) return 'text-warning';
  return 'text-destructive';
}

function avgScoreBg(score: number) {
  if (score >= 60) return 'bg-success/5 dark:bg-success/10 border-success/20';
  if (score >= 40) return 'bg-warning/5 dark:bg-warning/10 border-warning/20';
  return 'bg-destructive/5 dark:bg-destructive/10 border-destructive/20';
}

function avgScoreLabel(score: number) {
  if (score >= 60) return 'text-success';
  if (score >= 40) return 'text-warning';
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
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="ค้นหาชื่อลูกค้า..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors"
          />
        </div>

        <Select
          value={statusFilter || 'ALL'}
          onValueChange={(v) => onStatusFilterChange(v === 'ALL' ? '' : v)}
        >
          <SelectTrigger className="h-10 w-auto min-w-[140px]">
            <SelectValue placeholder="ทุกสถานะ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ทุกสถานะ</SelectItem>
            <SelectItem value="PENDING">รอวิเคราะห์</SelectItem>
            <SelectItem value="APPROVED">ผ่าน</SelectItem>
            <SelectItem value="REJECTED">ไม่ผ่าน</SelectItem>
            <SelectItem value="MANUAL_REVIEW">ต้องตรวจเพิ่ม</SelectItem>
          </SelectContent>
        </Select>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <ThaiDateInput
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="h-10 px-3 rounded-lg border border-input bg-background text-sm"
          />
          <span className="text-sm text-muted-foreground">ถึง</span>
          <ThaiDateInput
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="h-10 px-3 rounded-lg border border-input bg-background text-sm"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onDateRangeShortcut('today')}
            className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            วันนี้
          </button>
          <button
            onClick={() => onDateRangeShortcut('week')}
            className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            สัปดาห์นี้
          </button>
          <button
            onClick={() => onDateRangeShortcut('month')}
            className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            เดือนนี้
          </button>
          {(startDate || endDate) && (
            <button
              onClick={onClearDateRange}
              className="px-2 py-1.5 text-xs text-destructive border border-destructive/20 rounded-lg hover:bg-destructive/5 transition-colors"
            >
              ล้าง
            </button>
          )}
        </div>

        {/* Branch filter (OWNER only) */}
        {isOwner && branches.length > 0 && (
          <Select
            value={branchFilter || 'ALL'}
            onValueChange={(v) => onBranchFilterChange(v === 'ALL' ? '' : v)}
          >
            <SelectTrigger className="h-10 w-auto min-w-[140px]">
              <SelectValue placeholder="ทุกสาขา" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกสาขา</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Summary cards — 4-col layout (match CustomersPage) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 lg:gap-7.5 mb-6">
        <div className="bg-card rounded-xl border border-border/50 shadow-sm border-l-[3px] border-l-foreground p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
          <div className="text-xs text-muted-foreground">ทั้งหมด</div>
          <div className="text-xl font-bold">{summary?.totalCount ?? 0}</div>
        </div>
        <div className="bg-success/5 dark:bg-success/10 rounded-xl border border-success/20 shadow-sm border-l-[3px] border-l-success p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
          <div className="text-xs text-success">ผ่าน</div>
          <div className="text-xl font-bold text-success">{summary?.approvedCount ?? 0}</div>
        </div>
        <div className="bg-warning/5 dark:bg-warning/10 rounded-xl border border-warning/20 shadow-sm border-l-[3px] border-l-warning p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
          <div className="text-xs text-warning">รอ / ไม่ผ่าน</div>
          <div className="text-xl font-bold text-warning">
            <span className="text-warning">{summary?.pendingCount ?? 0}</span>
            <span className="text-muted-foreground mx-1 font-normal">/</span>
            <span className="text-destructive">{summary?.rejectedCount ?? 0}</span>
          </div>
        </div>
        <div
          className={`rounded-xl border shadow-sm border-l-[3px] p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all ${summary?.avgScore ? `${avgScoreBg(summary.avgScore)} border-l-[currentColor]` : 'bg-card border-border/50 border-l-muted-foreground'}`}
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

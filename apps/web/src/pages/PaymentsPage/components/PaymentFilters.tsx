import { Card, CardContent } from '@/components/ui/card';

interface PaymentFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  branchFilter: string;
  onBranchFilterChange: (value: string) => void;
  isOwner: boolean;
  branches: { id: string; name: string }[];
  pendingCount: number;
  pendingTotalDue: number;
  onExport: () => void;
  hasPendingPayments: boolean;
}

export default function PaymentFilters({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  branchFilter,
  onBranchFilterChange,
  isOwner,
  branches,
  pendingCount,
  pendingTotalDue,
  onExport,
  hasPendingPayments,
}: PaymentFiltersProps) {
  return (
    <>
      {/* Summary Cards — Metronic KPI style */}
      {hasPendingPayments && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รายการรอชำระ</div>
                <div className="text-2xl font-bold text-foreground tabular-nums">{pendingCount}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-destructive rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรอชำระรวม</div>
                <div className="text-2xl font-bold text-destructive tabular-nums">{pendingTotalDue.toLocaleString()} ฿</div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden border-dashed">
            <CardContent className="p-5 flex items-center justify-center h-full">
              <button
                onClick={onExport}
                className="inline-flex items-center gap-2 px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0-3-3m3 3 3-3m2 8H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" /></svg>
                ส่งออก Excel
              </button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-card rounded-xl border border-border/50 p-4 mb-5 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="ค้นหาเลขสัญญา, ชื่อ, เบอร์โทร..."
              className="w-full pl-9 pr-3 py-2 border border-input rounded-lg text-sm bg-background outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none focus:ring-2 focus:ring-ring/30"
          >
            <option value="">ทุกสถานะ</option>
            <option value="PENDING">รอชำระ</option>
            <option value="OVERDUE">เกินกำหนด</option>
            <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
          </select>
          {isOwner && (
            <select
              value={branchFilter}
              onChange={(e) => onBranchFilterChange(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">ทุกสาขา</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </>
  );
}

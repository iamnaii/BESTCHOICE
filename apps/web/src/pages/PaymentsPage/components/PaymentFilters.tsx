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
      {/* Summary Cards */}
      {hasPendingPayments && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="border-l-[3px] border-l-primary hover:shadow-card-hover transition-all">
            <CardContent className="p-4">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รายการรอชำระ</div>
              <div className="text-2xl font-bold">{pendingCount}</div>
            </CardContent>
          </Card>
          <Card className="border-l-[3px] border-l-destructive hover:shadow-card-hover transition-all">
            <CardContent className="p-4">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรอชำระรวม</div>
              <div className="text-2xl font-bold text-destructive">{pendingTotalDue.toLocaleString()} ฿</div>
            </CardContent>
          </Card>
          <Card className="border-l-[3px] border-l-primary hover:shadow-card-hover transition-all">
            <CardContent className="p-4">
              <button onClick={onExport} className="w-full px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted">
                📊 ส่งออก Excel
              </button>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="ค้นหาเลขสัญญา, ชื่อ, เบอร์โทร..."
          className="px-3 py-2 border border-input rounded-lg text-sm w-72"
        />
        <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
          <option value="">ทุกสถานะ</option>
          <option value="PENDING">รอชำระ</option>
          <option value="OVERDUE">เกินกำหนด</option>
          <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
        </select>
        {isOwner && (
          <select value={branchFilter} onChange={(e) => onBranchFilterChange(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>
    </>
  );
}

import { NativeSelect } from '@/components/ui/native-select';
import { formControlClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
interface PaymentFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  branchFilter: string;
  onBranchFilterChange: (value: string) => void;
  isOwner: boolean;
  branches: { id: string; name: string }[];
  onExport: () => void;
  hasPendingPayments: boolean;
  /** ชำระครบ tab pins status=PAID server-side — the pending-status dropdown is meaningless there. */
  showStatusFilter?: boolean;
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
  onExport,
  hasPendingPayments,
  showStatusFilter = true,
}: PaymentFiltersProps) {
  return (
    <div className="bg-card rounded-xl border border-border/50 p-4 mb-5 shadow-sm">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-55">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            aria-label="ค้นหาการชำระเงิน"
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ค้นหาเลขสัญญา, ชื่อ, เบอร์โทร..."
            className={cn(formControlClass, 'pl-9')}
          />
        </div>
        {showStatusFilter && (
          <NativeSelect wrapperClassName="max-w-full min-w-0 w-full sm:w-auto"
            aria-label="สถานะการชำระเงิน"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className={cn(formControlClass, "")}
          >
            <option value="">ทุกสถานะ</option>
            <option value="PENDING">รอชำระ</option>
            <option value="OVERDUE">เกินกำหนด</option>
            <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
          </NativeSelect>
        )}
        {isOwner && (
          <NativeSelect wrapperClassName="max-w-full min-w-0 w-full sm:w-auto"
            aria-label="สาขา"
            value={branchFilter}
            onChange={(e) => onBranchFilterChange(e.target.value)}
            className={cn(formControlClass, "")}
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </NativeSelect>
        )}
        <button
          onClick={onExport}
          disabled={!hasPendingPayments}
          className="inline-flex items-center gap-2 px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0-3-3m3 3 3-3m2 8H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" /></svg>
          ส่งออก Excel
        </button>
      </div>
    </div>
  );
}

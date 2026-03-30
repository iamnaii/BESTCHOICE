import { ChevronUp, ChevronDown } from 'lucide-react';

interface CustomerFiltersProps {
  search: string;
  setSearch: (value: string) => void;
  contractStatusFilter: string;
  setContractStatusFilter: (value: string) => void;
  creditStatusFilter: string;
  setCreditStatusFilter: (value: string) => void;
  hasOverdueFilter: boolean;
  setHasOverdueFilter: (value: boolean) => void;
  branchFilter: string;
  setBranchFilter: (value: string) => void;
  sortBy: string;
  setSortBy: (value: string) => void;
  sortOrder: string;
  setSortOrder: (value: string) => void;
  isOwner: boolean;
  branches: { id: string; name: string }[];
}

export default function CustomerFilters({
  search,
  setSearch,
  contractStatusFilter,
  setContractStatusFilter,
  creditStatusFilter,
  setCreditStatusFilter,
  hasOverdueFilter,
  setHasOverdueFilter,
  branchFilter,
  setBranchFilter,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  isOwner,
  branches,
}: CustomerFiltersProps) {
  return (
    <>
      {/* Filters */}
      <div className="bg-card rounded-lg border p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm outline-none"
          />
          <select
            value={contractStatusFilter}
            onChange={(e) => setContractStatusFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none"
          >
            <option value="">ทุกสถานะสัญญา</option>
            <option value="ACTIVE">มีสัญญา Active</option>
            <option value="COMPLETED">ปิดสัญญาแล้ว</option>
            <option value="DRAFT">ร่าง</option>
          </select>
          <select
            value={creditStatusFilter}
            onChange={(e) => setCreditStatusFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none"
          >
            <option value="">ทุกสถานะเครดิต</option>
            <option value="APPROVED">ผ่าน</option>
            <option value="REJECTED">ไม่ผ่าน</option>
            <option value="PENDING">รอตรวจ</option>
            <option value="MANUAL_REVIEW">รอตรวจสอบด้วยตนเอง</option>
          </select>
          <button
            onClick={() => setHasOverdueFilter(!hasOverdueFilter)}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              hasOverdueFilter
                ? 'bg-red-100 text-red-700 border-red-300'
                : 'border-input hover:bg-accent'
            }`}
          >
            ค้างชำระ
          </button>
        </div>
        {isOwner && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="w-full md:w-64 px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Sorting Controls */}
      <div className="bg-card rounded-lg border p-3 mb-4 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">เรียงลำดับ:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-2 py-1 border border-input rounded text-sm bg-background"
        >
          <option value="">เริ่มต้น (วันที่เพิ่มล่าสุด)</option>
          <option value="name">ชื่อ</option>
          <option value="createdAt">วันที่เพิ่ม</option>
          <option value="contractCount">จำนวนสัญญา</option>
          <option value="creditScore">เครดิตสกอร์</option>
        </select>
        {sortBy && (
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="px-2 py-1 border border-input rounded text-xs font-medium hover:bg-accent flex items-center gap-1"
          >
            {sortOrder === 'asc' ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                น้อยไปมาก
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                มากไปน้อย
              </>
            )}
          </button>
        )}
      </div>
    </>
  );
}

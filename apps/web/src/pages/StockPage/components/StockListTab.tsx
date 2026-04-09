import DataTable, { Column } from '@/components/ui/DataTable';
import { statusLabels, categoryLabels } from '@/lib/constants';
import { StockProduct } from '../types';

export interface StockListTabProps {
  search: string;
  setSearch: (search: string) => void;
  filterStatus: string;
  setFilterStatus: (status: string) => void;
  filterCategory: string;
  setFilterCategory: (category: string) => void;
  filterBranch: string;
  setFilterBranch: (branch: string) => void;
  branches: { id: string; name: string }[];
  columns: Column<StockProduct>[];
  listProducts: StockProduct[];
  listLoading: boolean;
  listResult: { data: StockProduct[]; total: number; page: number; totalPages: number } | undefined;
  page: number;
  setPage: (page: number) => void;
}

export function StockListTab({
  search,
  setSearch,
  filterStatus,
  setFilterStatus,
  filterCategory,
  setFilterCategory,
  filterBranch,
  setFilterBranch,
  branches,
  columns,
  listProducts,
  listLoading,
  listResult,
  page,
  setPage,
}: StockListTabProps) {
  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text"
          placeholder="ค้นหาชื่อ, ยี่ห้อ, รุ่น, IMEI..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกประเภท</option>
          {Object.entries(categoryLabels).map(([key, val]) => (
            <option key={key} value={key}>{val}</option>
          ))}
        </select>
        <select
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {filterBranch && (
          <button
            onClick={() => setFilterBranch('')}
            className="px-3 py-2 text-sm text-primary hover:text-primary-700"
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={listProducts}
        isLoading={listLoading}
        emptyMessage="ไม่พบสินค้า"
        pagination={listResult ? {
          page: listResult.page,
          totalPages: listResult.totalPages,
          total: listResult.total,
          onPageChange: setPage,
        } : undefined}
      />
    </>
  );
}

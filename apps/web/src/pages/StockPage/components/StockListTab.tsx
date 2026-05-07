import DataTable, { Column } from '@/components/ui/DataTable';
import { statusLabels, categoryLabels } from '@/lib/constants';
import { StockProduct } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Search, X } from 'lucide-react';

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
          className="flex-1 min-w-[200px] px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
          <option value="">ทุกประเภท</option>
          {Object.entries(categoryLabels).map(([key, val]) => (
            <option key={key} value={key}>{val}</option>
          ))}
        </select>
        <select
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {/* Active filter chips */}
      {(search || filterStatus || filterCategory || filterBranch) && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-muted-foreground">ตัวกรองที่ใช้:</span>
          {search && (
            <FilterChip label={`ค้นหา: "${search}"`} onRemove={() => setSearch('')} />
          )}
          {filterStatus && (
            <FilterChip
              label={`สถานะ: ${statusLabels[filterStatus]?.label || filterStatus}`}
              onRemove={() => setFilterStatus('')}
            />
          )}
          {filterCategory && (
            <FilterChip
              label={`ประเภท: ${categoryLabels[filterCategory] || filterCategory}`}
              onRemove={() => setFilterCategory('')}
            />
          )}
          {filterBranch && (
            <FilterChip
              label={`สาขา: ${branches.find((b) => b.id === filterBranch)?.name || filterBranch}`}
              onRemove={() => setFilterBranch('')}
            />
          )}
          <button
            onClick={() => {
              setSearch('');
              setFilterStatus('');
              setFilterCategory('');
              setFilterBranch('');
            }}
            className="ml-1 text-xs text-muted-foreground hover:text-foreground underline"
          >
            ล้างทั้งหมด
          </button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>รายการสินค้า</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={listProducts}
            isLoading={listLoading}
            emptyMessage={search || filterStatus || filterCategory || filterBranch ? 'ไม่พบสินค้าที่ตรงกับตัวกรอง' : 'ยังไม่มีสินค้าในคลัง'}
            emptyIcon={search ? Search : Package}
            emptyDescription={search || filterStatus || filterCategory || filterBranch ? 'ลองล้างตัวกรองหรือค้นหาด้วยคำอื่น' : undefined}
            columnToggle
            pagination={listResult ? {
              page: listResult.page,
              totalPages: listResult.totalPages,
              total: listResult.total,
              onPageChange: setPage,
            } : undefined}
          />
        </CardContent>
      </Card>
    </>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
      {label}
      <button
        onClick={onRemove}
        className="hover:bg-primary/20 rounded-full p-0.5 transition-colors"
        aria-label={`ลบ ${label}`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

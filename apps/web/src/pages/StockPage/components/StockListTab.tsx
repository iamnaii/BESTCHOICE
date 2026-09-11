import { useId, useState, type ReactNode } from 'react';
import DataTable, { type Column, type TableSort } from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/useIsMobile';
import { statusLabels } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { StockProduct } from '../types';
import { ChevronLeft, ChevronRight, Package, Search, SlidersHorizontal, X } from 'lucide-react';

export interface StockListTabProps {
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  accessoryGroupId: string;
  search: string;
  setSearch: (search: string) => void;
  clearFilters: () => void;
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
  listError: boolean;
  listErrorObj: unknown;
  listRefetch: () => void;
  listResult: { data: StockProduct[]; total: number; page: number; totalPages: number } | undefined;
  page: number;
  setPage: (page: number) => void;
  isManager: boolean;
  selectedIds: Set<string>;
  onSelectAll: () => void;
  bulkActions?: ReactNode;
}

const quickCategories = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'PHONE_NEW', label: 'มือ 1' },
  { value: 'PHONE_USED', label: 'มือ 2' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์' },
];
const priceKeys = ['costPrice', 'cashPrice', 'downPayment', 'monthlyPayment'];
const selectClass =
  'h-11 w-full min-w-0 cursor-pointer rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function StockListTab({
  accessoryGroupId,
  sort,
  onSortChange,
  search,
  setSearch,
  clearFilters,
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
  listError,
  listErrorObj,
  listRefetch,
  listResult,
  page,
  setPage,
  isManager,
  selectedIds,
  onSelectAll,
  bulkActions,
}: StockListTabProps) {
  const id = useId();
  const isMobile = useIsMobile();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCount = [filterStatus, filterBranch].filter(Boolean).length;
  const hasAdditionalFilters = !!(search || filterStatus || filterBranch);
  const hasFilters = hasAdditionalFilters || !!filterCategory;
  const emptyMessage = hasFilters ? 'ไม่พบสินค้าที่ตรงกับตัวกรอง' : 'ยังไม่มีสินค้าในคลัง';
  const priceColumns = columns.filter((column) => priceKeys.includes(column.key));
  const specificationColumns = columns.filter((column) =>
    [
      'productCode',
      'category',
      'specifications',
      'accessoryType',
      'storage',
      'color',
      'connectivity',
      'batteryHealth',
      'hasBox',
      'warrantyExpireDate',
      'stockInDate',
      'quantity',
    ].includes(column.key),
  );
  const renderCell = (key: string, product: StockProduct, index: number) => {
    const column = columns.find((item) => item.key === key);
    return column?.render?.(product, column, index);
  };
  const selectableProducts = listProducts.filter((product) => !product.stockGroup);
  const resultSummary = listResult
    ? `${hasFilters ? 'พบ' : 'ทั้งหมด'} ${listResult.total.toLocaleString()} รายการ${listResult.totalPages > 1 ? ` · หน้านี้ ${listProducts.length} รายการ` : ''}`
    : 'กำลังโหลดรายการสินค้า…';

  return (
    <section
      aria-label="คลังสินค้า"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <div
        role="group"
        aria-label="แบ่งประเภทสินค้า"
        className="grid grid-cols-5 border-b border-border px-2 sm:flex sm:gap-4 sm:px-5"
      >
        {quickCategories.map((category) => (
          <button
            key={category.value}
            type="button"
            aria-pressed={filterCategory === category.value}
            onClick={() => setFilterCategory(category.value)}
            className={cn(
              'relative min-h-14 cursor-pointer whitespace-nowrap px-1 text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3 sm:text-sm',
              filterCategory === category.value
                ? 'font-semibold text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-primary'
                : 'font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {category.label}
          </button>
        ))}
      </div>

      <div
        role="search"
        aria-label="ค้นหาและกรองสินค้า"
        className="border-b border-border bg-background/30 p-4 sm:px-5"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-[1_1_240px]">
            <label
              htmlFor={`${id}-search`}
              className="mb-2 block text-xs font-medium leading-snug text-foreground/80"
            >
              ค้นหาสินค้า
            </label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"
                />
                <Input
                  id={`${id}-search`}
                  placeholder="รุ่น / รหัส / IMEI"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-11 rounded-lg bg-card pl-10 pr-11 text-base shadow-xs lg:text-sm"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="ล้างคำค้น"
                    onClick={() => setSearch('')}
                    className="absolute right-0 top-0 flex size-11 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                )}
              </div>
              {isMobile && (
                <Button
                  variant={filtersOpen || filterCount > 0 ? 'secondary' : 'outline'}
                  className="h-11 shrink-0 rounded-lg px-3"
                  aria-label="ตัวกรอง"
                  aria-expanded={filtersOpen}
                  aria-controls={`${id}-filters`}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <SlidersHorizontal aria-hidden="true" className="size-4" />
                  {filterCount > 0 && <span className="text-xs tabular-nums">{filterCount}</span>}
                </Button>
              )}
            </div>
          </div>
          <div
            id={`${id}-filters`}
            hidden={isMobile && !filtersOpen}
            className={cn(
              'min-w-0 grid-cols-2 gap-3',
              isMobile && !filtersOpen ? 'hidden' : 'grid',
              isMobile ? 'basis-full' : 'w-[360px]',
            )}
          >
            <div className="min-w-0">
              <label
                htmlFor={`${id}-status`}
                className="mb-2 block text-xs font-medium leading-snug text-foreground/80"
              >
                สถานะ
              </label>
              <select
                id={`${id}-status`}
                value={filterStatus}
                onChange={(event) => setFilterStatus(event.target.value)}
                className={selectClass}
              >
                <option value="">ทุกสถานะ</option>
                {Object.entries(statusLabels).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label
                htmlFor={`${id}-branch`}
                className="mb-2 block text-xs font-medium leading-snug text-foreground/80"
              >
                สาขา
              </label>
              <select
                id={`${id}-branch`}
                value={filterBranch}
                onChange={(event) => setFilterBranch(event.target.value)}
                className={selectClass}
              >
                <option value="">ทุกสาขา</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {hasAdditionalFilters && (
            <Button
              variant="ghost"
              className="h-11 px-2 text-xs text-muted-foreground"
              aria-label="ล้างทั้งหมด"
              onClick={clearFilters}
            >
              <X aria-hidden="true" className="size-3.5" />
              ล้างทั้งหมด
            </Button>
          )}
        </div>
        {bulkActions && <div className="mt-4">{bulkActions}</div>}
      </div>

      <QueryBoundary
        // Keep header buttons and scroll position mounted while a new sort loads.
        isLoading={false}
        isError={listError}
        error={listErrorObj}
        onRetry={listRefetch}
        errorTitle="ไม่สามารถโหลดคลังสินค้าได้"
      >
        {isMobile ? (
          <>
            <div className="flex items-end gap-2 px-4 pt-4">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`${id}-sort`}
                  className="mb-2 block text-xs font-medium leading-snug"
                >
                  เรียงตาม
                </label>
                <select
                  id={`${id}-sort`}
                  className={selectClass}
                  value={sort?.key ?? ''}
                  onChange={(event) =>
                    onSortChange(
                      event.target.value ? { key: event.target.value, direction: 'asc' } : null,
                    )
                  }
                >
                  <option value="">ล่าสุด</option>
                  {columns
                    .filter((column) => column.sortable && column.label)
                    .map((column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ))}
                </select>
              </div>
              {sort && (
                <Button
                  variant="outline"
                  className="h-11"
                  aria-label="สลับทิศทางการเรียง"
                  onClick={() =>
                    onSortChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
                  }
                >
                  {sort.direction === 'asc' ? 'น้อย → มาก' : 'มาก → น้อย'}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <p className="text-xs text-muted-foreground leading-snug" role="status">
                {resultSummary}
              </p>
              {isManager && selectableProducts.length > 0 && (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium">
                  <Checkbox
                    aria-label="เลือกสินค้าหน้านี้"
                    checked={
                      selectableProducts.every((product) => selectedIds.has(product.id))
                        ? true
                        : selectedIds.size > 0
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={onSelectAll}
                  />
                  เลือกหน้านี้
                </label>
              )}
            </div>
            {listLoading ? (
              <div
                role="status"
                aria-label="กำลังโหลดสินค้า"
                className="p-8 text-center text-sm text-muted-foreground"
              >
                กำลังโหลด…
              </div>
            ) : listProducts.length === 0 ? (
              <EmptyState
                icon={hasFilters ? Search : Package}
                title={emptyMessage}
                description={
                  hasFilters
                    ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง'
                    : 'เพิ่มสินค้าเพื่อเริ่มจัดการคลัง'
                }
                actionLabel={hasFilters ? 'ล้างตัวกรอง' : undefined}
                onAction={clearFilters}
              />
            ) : (
              <ul
                aria-label="รายการสินค้า"
                className="grid gap-3 bg-background/30 p-3 pt-0 sm:grid-cols-2 sm:px-4"
              >
                {listProducts.map((product, index) => (
                  <li
                    key={product.id}
                    className={cn(
                      'min-w-0 overflow-hidden rounded-xl border bg-card p-4 shadow-xs',
                      selectedIds.has(product.id)
                        ? 'border-primary ring-1 ring-primary/20'
                        : 'border-border',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {renderCell('name', product, index)}
                      {isManager && !product.stockGroup && (
                        <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-accent">
                          {renderCell('select', product, index)}
                        </label>
                      )}
                    </div>
                    {specificationColumns.length > 0 && (
                      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
                        {specificationColumns.map((column) => (
                          <div
                            key={column.key}
                            className={cn(
                              'min-w-0',
                              ['warrantyExpireDate', 'connectivity'].includes(column.key) &&
                                'col-span-2',
                            )}
                          >
                            <dt className="mb-1 text-xs text-muted-foreground leading-snug">
                              {column.label}
                            </dt>
                            <dd className="text-sm font-medium">
                              {column.render?.(product, column, index)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <dl className="my-4 grid grid-cols-2 gap-x-5 gap-y-4 border-y border-border/70 py-4">
                      {priceColumns.map((column) => (
                        <div
                          key={column.key}
                          className={cn(
                            'min-w-0',
                            priceColumns.length === 3 && column.key === 'cashPrice' && 'col-span-2',
                          )}
                        >
                          <dt className="mb-1.5 text-xs text-muted-foreground leading-snug">
                            {column.label}
                          </dt>
                          <dd>{column.render?.(product, column, index)}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      {renderCell('status', product, index)}
                      {renderCell('branch', product, index)}
                    </div>
                    <div className="mt-1">{renderCell('actions', product, index)}</div>
                  </li>
                ))}
              </ul>
            )}
            {listResult && listResult.totalPages > 1 && (
              <nav
                aria-label="หน้ารายการสินค้า"
                className="flex items-center justify-between gap-2 border-t border-border px-4 py-3"
              >
                <Button
                  variant="outline"
                  className="h-11"
                  aria-label="ก่อนหน้า"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft aria-hidden="true" className="size-4" />
                  ก่อนหน้า
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {page} / {listResult.totalPages}
                </span>
                <Button
                  variant="outline"
                  className="h-11"
                  aria-label="ถัดไป"
                  disabled={page >= listResult.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  ถัดไป
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Button>
              </nav>
            )}
          </>
        ) : (
          <DataTable
            className="rounded-none border-0 shadow-none [&_th]:normal-case [&_th]:tracking-normal [&_th]:text-foreground/75"
            maxHeight="max(280px, calc(100dvh - 360px))"
            columns={columns}
            sort={sort}
            onSortChange={onSortChange}
            data={listProducts}
            isLoading={listLoading}
            emptyMessage={emptyMessage}
            emptyIcon={hasFilters ? Search : Package}
            emptyDescription={hasFilters ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : undefined}
            columnToggle={columns.some((column) => column.hideable !== false)}
            density="compact"
            minWidth={
              filterCategory === 'PHONE_USED'
                ? '1575px'
                : filterCategory === 'TABLET'
                  ? '1415px'
                  : filterCategory === 'PHONE_NEW'
                    ? '1255px'
                    : filterCategory === 'ACCESSORY'
                      ? '1200px'
                      : '1480px'
            }
            toolbar={
              <p role="status" className="text-xs text-muted-foreground leading-snug">
                {resultSummary}
              </p>
            }
            pagination={
              listResult
                ? {
                    page: listResult.page,
                    totalPages: listResult.totalPages,
                    total: listResult.total,
                    onPageChange: setPage,
                  }
                : undefined
            }
          />
        )}
      </QueryBoundary>
      <p className="space-y-1 border-t border-border/60 bg-background/30 px-4 py-3 text-xs text-muted-foreground leading-snug sm:px-5">
        {['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(filterCategory) && (
          <span className="block">
            วันที่รับเข้าใช้วันที่เข้าสต็อกพร้อมขายล่าสุด · นับวันเฉพาะสินค้าพร้อมขายและจอง
          </span>
        )}
        {!['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(filterCategory) && (
          <span className="block">
            {accessoryGroupId ? 'แสดงอุปกรณ์แยกรายชิ้น' : 'อุปกรณ์รวมตามสินค้า รุ่น สี และสาขา'} ·
            คงเหลือนับเฉพาะชิ้นที่พร้อมขายตามตัวกรอง ไม่รวมสินค้าจองและสถานะอื่น
          </span>
        )}
        {filterCategory !== 'ACCESSORY' && (
          <span className="block">
            ดาวน์และค่างวดเริ่มต้นของ BESTCHOICE ตามเงื่อนไขประเภทสินค้าและจำนวนงวดที่แสดง
          </span>
        )}
      </p>
    </section>
  );
}

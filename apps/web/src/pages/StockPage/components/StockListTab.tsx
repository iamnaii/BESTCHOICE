import type { StockInventoryScope } from '@installment/shared';
import { NativeSelect } from '@/components/ui/native-select';
import { useId, useState, type ReactNode } from 'react';
import DataTable, { type TableSort } from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import type { StockProduct } from '../types';
import type { StockView } from '../hooks/useStockProducts';
import type { StockColumn } from './stockColumns';
import './stock-comparison.css';
import { StockFilters } from './StockFilters';
import { ChevronLeft, ChevronRight, Package, Search } from 'lucide-react';

export interface StockListTabProps {
  inventoryScope?: StockInventoryScope;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  /** มุมมอง พร้อมขาย (ค่าเริ่มต้น) | ทั้งหมด — คำขอเจ้าของ 2026-09-11 */
  view: StockView;
  accessoryGroupId: string;
  filterDeviceOrigin: string;
  setFilterDeviceOrigin: (value: string) => void;
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
  columns: StockColumn[];
  listProducts: StockProduct[];
  listLoading: boolean;
  listError: boolean;
  listErrorObj: unknown;
  listRefetch: () => void;
  listResult:
    | { data: StockProduct[]; totalUnits?: number; total: number; page: number; totalPages: number }
    | undefined;
  page: number;
  setPage: (page: number) => void;
  isManager: boolean;
  selectedIds: Set<string>;
  onSelectAll: () => void;
  bulkActions?: ReactNode;
}

const priceKeys = ['costPrice', 'cashPrice', 'downPayment', 'gfin', 'margin'];
const selectClass =
  'h-11 w-full min-w-0 cursor-pointer rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function StockListTab({
  inventoryScope = 'all',
  accessoryGroupId,
  sort,
  onSortChange,
  view,
  filterDeviceOrigin,
  setFilterDeviceOrigin,
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
  const [compact, setCompact] = useState(false);
  const accessoryView = inventoryScope === 'accessories' || filterCategory === 'ACCESSORY';
  const selectedStatus = view === 'ready' ? 'IN_STOCK' : filterStatus;
  const hasFilters = !!(
    search ||
    selectedStatus ||
    filterBranch ||
    filterDeviceOrigin ||
    filterCategory
  );
  const emptyMessage = hasFilters ? 'ไม่พบสินค้าที่ตรงกับตัวกรอง' : 'ยังไม่มีสินค้าในคลัง';
  // ตารางคอมตัดคอลัมน์ที่ยุบเข้าช่องอื่นแล้วออก · การ์ดมือถือตัดคอลัมน์รวมสำหรับคอมออก
  const desktopColumns = columns.filter((column) => !column.desktopHidden);
  const mobileColumns = columns.filter((column) => !column.mobileHidden);
  const priceColumns = mobileColumns.filter((column) => priceKeys.includes(column.key));
  const specificationColumns = mobileColumns.filter((column) =>
    [
      'productCode',
      'imeiSerial',
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
  const unit = inventoryScope === 'devices' ? 'เครื่อง' : 'ชิ้น';
  const resultSummary = !listResult
    ? 'กำลังโหลดรายการสินค้า…'
    : `พบ ${(listResult.totalUnits ?? listResult.total).toLocaleString()} ${unit}${listResult.totalUnits != null && listResult.totalUnits !== listResult.total ? ` · ${listResult.total.toLocaleString()} กลุ่มสินค้า` : ''}${listResult.totalPages > 1 ? ` · หน้านี้ ${listProducts.length} รายการ` : ''}`;
  const summaryNode = (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-xs text-muted-foreground leading-snug">
        {resultSummary}
      </p>
      {!isMobile && (
        <div
          role="group"
          aria-label="ความกระชับของตาราง"
          className="flex items-center gap-1 rounded-lg bg-muted p-1"
        >
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={compact === value}
              onClick={() => setCompact(value)}
              className={cn(
                'min-h-11 cursor-pointer rounded-md px-3 text-xs focus-visible:ring-2 focus-visible:ring-ring',
                compact === value
                  ? 'bg-card shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value ? 'กระชับ' : 'สบายตา'}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section
      aria-label="คลังสินค้า"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <StockFilters
        inventoryScope={inventoryScope}
        accessoryView={accessoryView}
        search={search}
        setSearch={setSearch}
        status={selectedStatus}
        setStatus={setFilterStatus}
        category={filterCategory}
        setCategory={setFilterCategory}
        branch={filterBranch}
        setBranch={setFilterBranch}
        branches={branches}
        origin={filterDeviceOrigin}
        setOrigin={setFilterDeviceOrigin}
        clearFilters={clearFilters}
      />
      {bulkActions && <div className="border-b border-border px-4 py-3 sm:px-5">{bulkActions}</div>}

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
                <NativeSelect
                  wrapperClassName="max-w-full w-full min-w-0"
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
                  {!accessoryView && <option value="monthlyPayment">ค่างวด BESTCHOICE</option>}
                  {columns
                    .filter((column) => column.sortable && column.label)
                    .map((column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ))}
                </NativeSelect>
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
              {summaryNode}
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
                actionLabel={hasFilters ? 'ล้างตัวกรองและแสดงสินค้า' : undefined}
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
                              ['imeiSerial', 'warrantyExpireDate', 'connectivity'].includes(
                                column.key,
                              ) && 'col-span-2',
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
            key={`${inventoryScope}-${filterCategory}`}
            responsive={false}
            className={cn(
              'stock-comparison rounded-none border-0 shadow-none [&_th]:normal-case [&_th]:tracking-normal',
              compact && 'stock-compact',
            )}
            maxHeight="max(280px, calc(100dvh - 360px))"
            columns={desktopColumns}
            sort={sort}
            onSortChange={onSortChange}
            data={listProducts}
            isLoading={listLoading}
            emptyMessage={emptyMessage}
            emptyIcon={hasFilters ? Search : Package}
            emptyDescription={hasFilters ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : undefined}
            columnToggle={desktopColumns.some((column) => column.hideable !== false)}
            density="dense"
            // Relative widths fit the desktop workspace; mobile uses cards above.
            minWidth="0"
            toolbar={summaryNode}
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
        {!accessoryView && (
          <span className="block">
            วันที่รับเข้าใช้วันที่เข้าสต็อกพร้อมขายล่าสุด · นับวันเฉพาะสินค้าพร้อมขายและจอง
            {inventoryScope === 'all' && !filterCategory && ' · กลุ่มอุปกรณ์ไม่แสดงวันที่'}
          </span>
        )}
        {(accessoryView || (inventoryScope === 'all' && !filterCategory)) && (
          <span className="block">
            {accessoryGroupId ? 'แสดงอุปกรณ์แยกรายชิ้น' : 'อุปกรณ์รวมตามสินค้า รุ่น สี และสาขา'} ·
            คงเหลือนับเฉพาะชิ้นที่พร้อมขายตามตัวกรอง ไม่รวมสินค้าจองและสถานะอื่น
          </span>
        )}
        {!accessoryView && (
          <span className="block">
            BESTCHOICE / GFIN: บรรทัดบนคือเงินดาวน์ · บรรทัดล่างคือค่างวดต่อเดือน × จำนวนงวด ·
            ตามเงื่อนไขที่ตั้งไว้
          </span>
        )}
      </p>
    </section>
  );
}

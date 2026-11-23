import { useId } from 'react';
import { Search, X } from '@/lib/icons';
import type { StockInventoryScope } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { DeviceOriginFilter } from '@/components/product/DeviceOriginFilter';
import { statusLabels } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface StockFiltersProps {
  inventoryScope: StockInventoryScope;
  accessoryView: boolean;
  search: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  branch: string;
  setBranch: (value: string) => void;
  branches: { id: string; name: string }[];
  origin: string;
  setOrigin: (value: string) => void;
  clearFilters: () => void;
}

const categories = [
  { value: '', label: 'ทุกประเภท' },
  { value: 'PHONE_NEW', label: 'มือถือมือ 1' },
  { value: 'PHONE_USED', label: 'มือถือมือ 2' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];
const originLabels: Record<string, string> = {
  THAI: 'เครื่องไทย',
  IMPORTED: 'เครื่องนอก',
  UNKNOWN: 'ยังไม่ระบุ',
};
const controlClass = 'h-11 w-full min-w-0 rounded-lg border-input bg-card text-sm shadow-xs';
const labelClass = 'mb-2 block text-xs font-medium leading-snug text-muted-foreground';

export function StockFilters({
  inventoryScope,
  accessoryView,
  search,
  setSearch,
  status,
  setStatus,
  category,
  setCategory,
  branch,
  setBranch,
  branches,
  origin,
  setOrigin,
  clearFilters,
}: StockFiltersProps) {
  const id = useId();
  const chips = [
    ...(search ? [{ key: 'search', label: `ค้นหา: ${search}`, clear: () => setSearch('') }] : []),
    ...(status
      ? [
          {
            key: 'status',
            label: `สถานะ: ${statusLabels[status]?.label ?? status}`,
            clear: () => setStatus(''),
          },
        ]
      : []),
    ...(category && (inventoryScope !== 'accessories' || category !== 'ACCESSORY')
      ? [
          {
            key: 'category',
            label: `ประเภท: ${categories.find((c) => c.value === category)?.label ?? category}`,
            clear: () => setCategory(''),
          },
        ]
      : []),
    ...(branch
      ? [
          {
            key: 'branch',
            label: `สาขา: ${branches.find((b) => b.id === branch)?.name ?? branch}`,
            clear: () => setBranch(''),
          },
        ]
      : []),
    ...(!accessoryView && origin
      ? [
          {
            key: 'origin',
            label: `แหล่งที่มา: ${originLabels[origin] ?? origin}`,
            clear: () => setOrigin(''),
          },
        ]
      : []),
  ];
  return (
    <div
      role="search"
      aria-label="ค้นหาและกรองสินค้า"
      className="space-y-4 border-b border-border p-4 sm:p-5"
    >
      <div className="grid min-w-0 grid-cols-2 items-end gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_11rem]">
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <label htmlFor={`${id}-search`} className={labelClass}>
            ค้นหาสินค้า
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"
            />
            <Input
              id={`${id}-search`}
              placeholder={
                accessoryView ? 'ชื่อสินค้า / รุ่นที่รองรับ / SKU' : 'ชื่อรุ่น / รหัสสินค้า / IMEI'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(controlClass, 'pl-10 pr-11 text-base lg:text-sm')}
            />
            {search && (
              <button
                type="button"
                aria-label="ล้างคำค้น"
                onClick={() => setSearch('')}
                className="absolute right-0 top-0 flex size-11 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-status`} className={labelClass}>
            สถานะ
          </label>
          <NativeSelect
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            wrapperClassName="w-full min-w-0"
            className={controlClass}
          >
            <option value="">ทุกสถานะ</option>
            {Object.entries(statusLabels).map(([value, item]) => (
              <option key={value} value={value}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-branch`} className={labelClass}>
            สาขา
          </label>
          <NativeSelect
            id={`${id}-branch`}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            wrapperClassName="w-full min-w-0"
            className={controlClass}
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {inventoryScope !== 'accessories' && (
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div role="group" aria-label="แบ่งประเภทสินค้า" className="min-w-0 flex-1 basis-80">
            <span className={labelClass}>ประเภทสินค้า</span>
            <div className="flex flex-wrap gap-2">
              {categories
                .filter((c) => inventoryScope === 'all' || c.value !== 'ACCESSORY')
                .map((c) => (
                  <button
                    type="button"
                    key={c.value}
                    aria-pressed={category === c.value}
                    onClick={() => setCategory(c.value)}
                    className={cn(
                      'min-h-11 cursor-pointer rounded-lg border px-3 text-sm leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      category === c.value
                        ? 'border-primary/40 bg-primary/10 font-semibold text-primary'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
            </div>
          </div>
          {!accessoryView && (
            <div className="w-full min-w-0 sm:w-48">
              <label htmlFor={`${id}-origin`} className={labelClass}>
                เครื่องไทย / เครื่องนอก
              </label>
              <DeviceOriginFilter
                id={`${id}-origin`}
                value={origin}
                onChange={setOrigin}
                wrapperClassName="mb-0 w-full"
                className={controlClass}
              />
            </div>
          )}
        </div>
      )}
      {chips.length > 0 && (
        <div
          role="group"
          aria-label="ตัวกรองที่ใช้"
          className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
        >
          <span className="mr-1 text-xs text-muted-foreground">กำลังกรอง</span>
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.key}
              aria-label={`ลบ ${chip.label}`}
              onClick={chip.clear}
              className="inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 text-xs leading-snug hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 text-left break-words [overflow-wrap:anywhere]">
                {chip.label}
              </span>
              <X aria-hidden="true" className="size-3.5 shrink-0" />
            </button>
          ))}
          <Button
            variant="ghost"
            className="min-h-11 text-xs text-muted-foreground"
            onClick={clearFilters}
          >
            ล้างตัวกรอง
          </Button>
        </div>
      )}
    </div>
  );
}

import { Smartphone, Package, Layers } from '@/lib/icons';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { isStockInventoryScope, type StockInventoryScope } from '@installment/shared';

export const inventoryScopeLabels = {
  devices: 'เครื่อง',
  accessories: 'อุปกรณ์เสริม',
  all: 'ทั้งหมด',
};
export function InventoryScopeFilter({
  value,
  onValueChange,
}: {
  value: StockInventoryScope;
  onValueChange: (value: StockInventoryScope) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => {
          if (isStockInventoryScope(next)) onValueChange(next);
        }}
        aria-label="หมวดสินค้าที่แสดง"
        className="w-full sm:w-auto rounded-xl border border-border bg-muted p-1"
      >
        {(
          [
            ['devices', Smartphone],
            ['accessories', Package],
            ['all', Layers],
          ] as const
        ).map(([key, Icon]) => (
          <ToggleGroupItem
            key={key}
            value={key}
            className="min-h-11 flex-1 sm:flex-none whitespace-nowrap gap-2 rounded-lg px-3 sm:px-4 text-sm data-[state=on]:bg-card data-[state=on]:text-primary data-[state=on]:shadow-sm"
          >
            <Icon className="hidden sm:block size-4" aria-hidden />
            {inventoryScopeLabels[key]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-sm text-muted-foreground">
        {value === 'devices'
          ? 'มือถือและแท็บเล็ต ไม่รวมอุปกรณ์เสริม'
          : value === 'accessories'
            ? 'เคส ฟิล์ม ชุดชาร์จ และอุปกรณ์เสริม'
            : 'รวมเครื่องและอุปกรณ์เสริมทุกประเภท'}
      </p>
    </div>
  );
}

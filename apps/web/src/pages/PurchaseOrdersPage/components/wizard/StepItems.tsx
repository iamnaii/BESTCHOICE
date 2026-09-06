import { useEffect, useRef } from 'react';
import { Package } from 'lucide-react';
import { formatNumberDecimal } from '@/utils/formatters';
import type { ItemForm } from '../../types';
import type { AccessorySku, CatalogEntry, PhoneMode } from '../../po-catalog.util';
import { CatalogPicker } from './items/CatalogPicker';
import { DeviceItemRow } from './items/DeviceItemRow';
import { AccessoryItemRow } from './items/AccessoryItemRow';

interface StepItemsProps {
  items: ItemForm[];
  updateItem: (idx: number, field: string, value: string) => void;
  toggleModel: (idx: number, modelName: string) => void;
  removeItem: (idx: number) => void;
  duplicateItem: (idx: number) => void;
  addCatalogItem: (entry: CatalogEntry, phoneMode: PhoneMode) => void;
  addAccessoryItem: (accessoryType: string) => void;
  addExistingAccessoryItem: (sku: AccessorySku) => void;
  searchAccessorySkus: (search: string) => Promise<AccessorySku[]>;
  subtotal: number;
  /** Wording overrides — รับเข้าตรง reuses the step with cost-price labels. */
  labels?: { title?: string; hint?: string; price?: string; total?: string; footerTotal?: string };
}

const th = 'px-2.5 py-2.5 text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground';
const DEFAULT_LABELS = {
  title: 'รายการสินค้า',
  hint: 'ค้นหารุ่นแล้วกดเพิ่ม — สภาพ / ความจุ / สี / จำนวน / ราคา เลือกในตาราง · อุปกรณ์เสริมค้นจากสินค้าเดิมหรือสร้างรายการใหม่',
  price: 'ราคา/ชิ้น',
  total: 'รวม',
  footerTotal: '',
};

/**
 * Step 2 of the PO wizard — search-first picker + one table row per line.
 * Top: one search box (catalog for โทรศัพท์/แท็บเล็ต, existing products for อุปกรณ์เสริม)
 * plus one-click chips. Below: a table whose columns line up across every row
 * (รุ่น | สภาพ | ความจุ | สี | จำนวน | ราคา/ชิ้น | รวม); accessory rows merge the middle
 * columns. Same ItemForm shape as before, so totals/submit are untouched.
 */
export function StepItems({
  items,
  updateItem,
  toggleModel,
  removeItem,
  duplicateItem,
  addCatalogItem,
  addAccessoryItem,
  addExistingAccessoryItem,
  searchAccessorySkus,
  subtotal,
  labels,
}: StepItemsProps) {
  const t = { ...DEFAULT_LABELS, ...labels };
  const pieces = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);

  // A quick-chip add lands the user on the new row (its first choice), not back in the
  // search box — the parent appends the row, so the focus moves once the row exists.
  const tableRef = useRef<HTMLTableElement>(null);
  const focusNewRow = useRef(false);
  useEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    const row = tableRef.current?.querySelector('tbody tr:last-of-type');
    row?.querySelector<HTMLElement>('select[aria-label="ความจุ"], input[aria-label="ยี่ห้ออุปกรณ์"]')?.focus();
  }, [items.length]);

  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Package className="size-4.5" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold leading-snug text-foreground">{t.title}</h3>
          <p className="text-xs leading-snug text-muted-foreground">{t.hint}</p>
        </div>
      </div>

      <CatalogPicker
        onPick={(entry, via) => {
          if (via === 'chip') focusNewRow.current = true;
          addCatalogItem(entry, 'PHONE_NEW');
        }}
        onPickAccessory={(type) => {
          focusNewRow.current = true;
          addAccessoryItem(type);
        }}
        onPickExisting={addExistingAccessoryItem}
        searchAccessorySkus={searchAccessorySkus}
      />

      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table ref={tableRef} className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            {/* # 32 | รุ่น (rest ≈ 282px) | สภาพ 112 | ความจุ 120 | สี 176 | จำนวน 132 (stepper 110) | ราคา 136 | รวม 120 | ⧉ × 80 */}
            <col className="w-8" />
            <col />
            <col className="w-28" />
            <col className="w-30" />
            <col className="w-44" />
            <col className="w-33" />
            <col className="w-34" />
            <col className="w-30" />
            <col className="w-20" />
          </colgroup>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className={th}>#</th>
              <th scope="col" className={th}>รุ่น</th>
              <th scope="col" className={th}>สภาพ</th>
              <th scope="col" className={th}>ความจุ</th>
              <th scope="col" className={th}>สี</th>
              <th scope="col" className={th}>จำนวน</th>
              <th scope="col" className={th}>{t.price}</th>
              <th scope="col" className={`${th} text-right`}>{t.total}</th>
              <th scope="col" className={th}>
                <span className="sr-only">จัดการ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">ยังไม่มีรายการ</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    พิมพ์ชื่อรุ่นในช่องค้นหา หรือกดรุ่นล่าสุดด้านบนเพื่อเพิ่มแถว
                  </p>
                </td>
              </tr>
            ) : (
              items.map((item, idx) =>
                item.category === 'ACCESSORY' ? (
                  <AccessoryItemRow
                    key={idx}
                    item={item}
                    idx={idx}
                    onChange={(field, value) => updateItem(idx, field, value)}
                    onToggleModel={(name) => toggleModel(idx, name)}
                    onDuplicate={() => duplicateItem(idx)}
                    onRemove={() => removeItem(idx)}
                  />
                ) : (
                  <DeviceItemRow
                    key={idx}
                    item={item}
                    idx={idx}
                    onChange={(field, value) => updateItem(idx, field, value)}
                    onDuplicate={() => duplicateItem(idx)}
                    onRemove={() => removeItem(idx)}
                  />
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      {/* Running subtotal footer */}
      <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
        <span className="text-sm leading-snug text-muted-foreground">
          รวม {items.length} รายการ · {pieces} ชิ้น
        </span>
        <span className="inline-flex items-baseline gap-2">
          {t.footerTotal && <span className="text-xs text-muted-foreground">{t.footerTotal}</span>}
          <span className="font-mono text-base font-semibold tabular-nums text-foreground">
            {formatNumberDecimal(subtotal, 2)} บาท
          </span>
        </span>
      </div>
    </div>
  );
}

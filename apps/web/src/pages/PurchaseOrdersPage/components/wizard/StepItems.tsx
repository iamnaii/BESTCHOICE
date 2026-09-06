import { useEffect, useRef } from 'react';
import { Package } from 'lucide-react';
import { formatNumberDecimal } from '@/utils/formatters';
import type { ItemForm } from '../../types';
import type { CatalogEntry, PhoneMode } from '../../po-catalog.util';
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
  subtotal: number;
}

const th = 'px-2 py-2 text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground';

/**
 * Step 2 of the PO wizard — search-first picker + one table row per line.
 * Top: one search box over the catalog (+ โทรศัพท์/แท็บเล็ต/อุปกรณ์เสริม and one-click
 * latest models). Below: a table whose columns line up across every row
 * (รุ่น | สภาพ | ความจุ | สี | จำนวน | ราคา/ชิ้น | รวม). Same ItemForm shape as before, so
 * review/totals/submit are untouched.
 */
export function StepItems({
  items,
  updateItem,
  toggleModel,
  removeItem,
  duplicateItem,
  addCatalogItem,
  addAccessoryItem,
  subtotal,
}: StepItemsProps) {
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
          <h3 className="text-sm font-semibold leading-snug text-foreground">รายการสินค้า</h3>
          <p className="text-xs leading-snug text-muted-foreground">
            ค้นหารุ่นแล้วกดเพิ่ม — เลือกสภาพ / ความจุ / สี / จำนวน / ราคาในตาราง
          </p>
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
      />

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table ref={tableRef} className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            {/* # | รุ่น (rest ≈ 172px) | สภาพ (fits "มือสอง") | ความจุ | สี | จำนวน (stepper = 106px) | ราคา | รวม | ⧉ × */}
            <col className="w-7" />
            <col />
            <col className="w-25" />
            <col className="w-26" />
            <col className="w-35" />
            <col className="w-31" />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-14" />
          </colgroup>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className={th}>#</th>
              <th scope="col" className={th}>รุ่น</th>
              <th scope="col" className={th}>สภาพ</th>
              <th scope="col" className={th}>ความจุ</th>
              <th scope="col" className={th}>สี</th>
              <th scope="col" className={th}>จำนวน</th>
              <th scope="col" className={th}>ราคา/ชิ้น</th>
              <th scope="col" className={`${th} text-right`}>รวม</th>
              <th scope="col" className={th}>
                <span className="sr-only">จัดการ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center">
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
      <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
        <span className="text-sm leading-snug text-muted-foreground">
          รวม {items.length} รายการ · {pieces} ชิ้น
        </span>
        <span className="font-mono text-base font-semibold tabular-nums text-foreground">
          {formatNumberDecimal(subtotal, 2)} บาท
        </span>
      </div>
    </div>
  );
}

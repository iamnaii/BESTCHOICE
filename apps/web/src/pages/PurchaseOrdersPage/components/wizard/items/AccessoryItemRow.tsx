import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { chargerConnectorTypes } from '../../../constants';
import { catalogEntries, isAccessoryProductCode } from '../../../po-catalog.util';
import type { ItemForm } from '../../../types';
import { ActionsCell, LabeledControl, MoneyCells, cellCls, inputCls, selectCls } from './RowChrome';

interface AccessoryItemRowProps {
  item: ItemForm;
  idx: number;
  onChange: (field: string, value: string) => void;
  onToggleModel: (modelName: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/**
 * One accessory line. รุ่น+สภาพ merge into the identity cell and ความจุ+สี into the detail
 * cell, so the money columns stay aligned with the device rows. The type is fixed by the
 * chip that created the row (owner 2026-09-06) and each kind gets exactly the control it
 * needs: ฟิล์ม may fit several models, เคส one, ชุดชาร์จ a connector, หูฟัง/อื่นๆ free text.
 * A re-ordered EXISTING product shows its name + code read-only — nothing left to pick.
 */
export function AccessoryItemRow({ item, idx, onChange, onToggleModel, onDuplicate, onRemove }: AccessoryItemRowProps) {
  const existing = isAccessoryProductCode(item.accessoryType);
  const type = item.accessoryType || 'อุปกรณ์เสริม';
  const label = existing ? item.sourceName || item.model : type;

  return (
    <tr
      aria-label={`รายการ #${idx + 1}: ${label}`}
      className="border-t border-border/60 bg-primary/5 transition-colors dark:bg-primary/10"
    >
      <td className={cn(cellCls, 'text-xs tabular-nums text-muted-foreground')}>{idx + 1}</td>
      <td colSpan={2} className={cellCls}>
        {existing ? (
          <>
            <div className="truncate text-sm font-semibold leading-snug text-foreground" title={label}>
              {label}
            </div>
            <p className="mt-0.5 truncate text-2xs leading-snug text-muted-foreground">
              สินค้าเดิม
              {item.accessoryBrand ? ` · ${item.accessoryBrand}` : ''}
              {item.sourceInStock != null ? ` · คงเหลือ ${item.sourceInStock} ชิ้น` : ''}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="w-16 shrink-0 text-sm font-semibold leading-snug text-foreground">{type}</span>
            <input
              aria-label="ยี่ห้ออุปกรณ์"
              type="text"
              value={item.accessoryBrand}
              onChange={(e) => onChange('accessoryBrand', e.target.value)}
              placeholder="ยี่ห้อ เช่น Spigen"
              className={cn(inputCls, 'min-w-0 flex-1')}
            />
          </div>
        )}
      </td>
      <td colSpan={2} className={cellCls}>
        <DetailControl item={item} existing={existing} onChange={onChange} onToggleModel={onToggleModel} />
      </td>
      <MoneyCells
        quantity={item.quantity}
        unitPrice={item.unitPrice}
        onQuantity={(v) => onChange('quantity', v)}
        onUnitPrice={(v) => onChange('unitPrice', v)}
      />
      <ActionsCell onDuplicate={onDuplicate} onRemove={onRemove} />
    </tr>
  );
}

/** The one control each accessory kind needs, in a fixed label track so all rows line up. */
function DetailControl({
  item,
  existing,
  onChange,
  onToggleModel,
}: {
  item: ItemForm;
  existing: boolean;
  onChange: (field: string, value: string) => void;
  onToggleModel: (modelName: string) => void;
}) {
  if (existing) {
    return (
      <LabeledControl label="รหัสสินค้า">
        <input
          aria-label="รหัสสินค้า"
          type="text"
          readOnly
          value={item.sourceCode ?? '—'}
          className={cn(inputCls, 'w-full bg-muted/40 font-mono text-muted-foreground')}
        />
      </LabeledControl>
    );
  }
  switch (item.accessoryType) {
    case 'ฟิล์ม':
      return (
        <LabeledControl label="สำหรับรุ่น">
          <CompatibleModelsPicker selected={item.model ? item.model.split(', ').filter(Boolean) : []} onToggle={onToggleModel} />
        </LabeledControl>
      );
    case 'เคส':
      return (
        <LabeledControl label="สำหรับรุ่น">
          <select aria-label="สำหรับรุ่น" value={item.model} onChange={(e) => onChange('model', e.target.value)} className={selectCls}>
            <option value="">— เลือกรุ่น —</option>
            {catalogEntries().map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </LabeledControl>
      );
    case 'ชุดชาร์จ':
      return (
        <LabeledControl label="หัวชาร์จ">
          <select aria-label="หัวชาร์จ" value={item.model} onChange={(e) => onChange('model', e.target.value)} className={selectCls}>
            <option value="">— เลือก —</option>
            {chargerConnectorTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </LabeledControl>
      );
    case 'หูฟัง':
      return (
        <LabeledControl label="รุ่น">
          <input
            aria-label="รุ่น"
            type="text"
            value={item.model}
            onChange={(e) => onChange('model', e.target.value)}
            placeholder="เช่น AirPods Pro 2"
            className={cn(inputCls, 'w-full')}
          />
        </LabeledControl>
      );
    default:
      return (
        <LabeledControl label="รายละเอียด">
          <input
            aria-label="รายละเอียด"
            type="text"
            value={item.model}
            onChange={(e) => onChange('model', e.target.value)}
            placeholder="เช่น สายชาร์จ 1 ม."
            className={cn(inputCls, 'w-full')}
          />
        </LabeledControl>
      );
  }
}

/** ฟิล์ม "สำหรับรุ่น" — one box listing the chosen models + a count, opening a multi-pick list. */
function CompatibleModelsPicker({ selected, onToggle }: { selected: string[]; onToggle: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const all = catalogEntries();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="สำหรับรุ่น" className={cn(selectCls, 'flex cursor-pointer items-center gap-2 text-left')}>
          <span className={cn('min-w-0 flex-1 truncate', selected.length === 0 && 'text-muted-foreground')}>
            {selected.length > 0 ? selected.join(', ') : 'เลือกรุ่นที่รองรับ'}
          </span>
          {selected.length > 0 && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-primary">
              {selected.length}
            </span>
          )}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="ค้นหารุ่น..." />
          <CommandList className="max-h-64">
            <CommandEmpty>ไม่พบรุ่น</CommandEmpty>
            <CommandGroup heading="เลือกได้หลายรุ่น">
              {all.map((e) => {
                const on = selected.includes(e.name);
                return (
                  <CommandItem key={e.name} value={e.name} aria-label={e.name} onSelect={() => onToggle(e.name)}>
                    <Check className={cn('size-4', on ? 'text-primary opacity-100' : 'opacity-0')} />
                    <span className="flex-1 truncate">{e.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

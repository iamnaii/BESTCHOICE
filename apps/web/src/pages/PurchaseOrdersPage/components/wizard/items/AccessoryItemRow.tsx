import { useState } from 'react';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { accessoryTypes, chargerConnectorTypes } from '../../../constants';
import { catalogEntries, itemLabel } from '../../../po-catalog.util';
import type { ItemForm } from '../../../types';
import { ChipGroup } from './ChipGroup';
import { ActionsCell, MoneyCells, cellCls, inputCls, selectCls } from './RowChrome';

interface AccessoryItemRowProps {
  item: ItemForm;
  idx: number;
  onChange: (field: string, value: string) => void;
  onToggleModel: (modelName: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/**
 * One accessory line. The first four columns (รุ่น | สภาพ | ความจุ | สี) are merged into a
 * single cell holding type / brand / connector-or-compatible-models, while the money
 * columns stay aligned with the device rows.
 */
export function AccessoryItemRow({ item, idx, onChange, onToggleModel, onDuplicate, onRemove }: AccessoryItemRowProps) {
  const isCharger = item.accessoryType === 'ชุดชาร์จ';
  const selectedModels = item.model ? item.model.split(', ').filter(Boolean) : [];
  const autoName = itemLabel(item);

  return (
    <tr
      aria-label={`รายการ #${idx + 1}: ${item.accessoryType || 'อุปกรณ์เสริม'}`}
      className="border-t border-border/60 bg-primary/5 transition-colors dark:bg-primary/10"
    >
      <td className={cn(cellCls, 'text-xs tabular-nums text-muted-foreground')}>{idx + 1}</td>
      <td colSpan={4} className={cellCls}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-2xs font-medium text-primary dark:bg-primary/20">
            อุปกรณ์เสริม
          </span>
          <select
            aria-label="ประเภทอุปกรณ์"
            value={item.accessoryType}
            onChange={(e) => onChange('accessoryType', e.target.value)}
            className={cn(selectCls, 'w-28')}
          >
            <option value="">— ประเภท —</option>
            {accessoryTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            aria-label="ยี่ห้ออุปกรณ์"
            type="text"
            value={item.accessoryBrand}
            onChange={(e) => onChange('accessoryBrand', e.target.value)}
            placeholder="ยี่ห้อ เช่น Spigen"
            className={cn(inputCls, 'w-36')}
          />
          {isCharger ? (
            <ChipGroup
              label="ชนิดหัวชาร์จ"
              hideLabel
              options={chargerConnectorTypes.map((t) => t.value)}
              value={item.model}
              onChange={(v) => onChange('model', v)}
            />
          ) : (
            <CompatibleModels selected={selectedModels} onToggle={onToggleModel} />
          )}
        </div>
        {autoName && (
          <p className="mt-1.5 text-xs leading-snug text-primary">ชื่อสินค้า: {autoName}</p>
        )}
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

/** "สำหรับรุ่น" — selected models as removable chips + a searchable multi-pick list. */
function CompatibleModels({ selected, onToggle }: { selected: string[]; onToggle: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const all = catalogEntries();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">สำหรับรุ่น</span>
      {selected.map((name) => (
        <span
          key={name}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary dark:bg-primary/15"
        >
          {name}
          <button
            type="button"
            aria-label={`เอา ${name} ออก`}
            onClick={() => onToggle(name)}
            className="grid size-5 cursor-pointer place-items-center rounded-full hover:bg-primary/20"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="เลือกรุ่นที่รองรับ"
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-dashed border-input bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Plus className="size-3" />
            เลือกรุ่น
            <ChevronDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="ค้นหารุ่น..." />
            <CommandList className="max-h-60">
              <CommandEmpty>ไม่พบรุ่น</CommandEmpty>
              <CommandGroup>
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
    </div>
  );
}

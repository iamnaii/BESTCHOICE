import { getModelInfo } from '@/data/productCatalog';
import { cn } from '@/lib/utils';
import type { ItemForm } from '../../../types';
import { ChipGroup } from './ChipGroup';
import { ActionsCell, CompactSelect, MoneyCells, cellCls } from './RowChrome';

interface DeviceItemRowProps {
  item: ItemForm;
  idx: number;
  onChange: (field: string, value: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

const CONDITION = [
  { value: 'PHONE_NEW', label: 'ใหม่' },
  { value: 'PHONE_USED', label: 'มือสอง' },
];

/** One phone/tablet line of the items table: # | รุ่น (+ ใหม่/มือสอง) | ความจุ | สี | จำนวน | ราคา | รวม | ⧉ × */
export function DeviceItemRow({ item, idx, onChange, onDuplicate, onRemove }: DeviceItemRowProps) {
  const info = item.brand && item.model ? getModelInfo(item.brand, item.model) : undefined;
  const isTablet = item.category === 'TABLET';

  return (
    <tr
      aria-label={`รายการ #${idx + 1}: ${item.model || 'ไม่ระบุรุ่น'}`}
      className="border-t border-border/60 transition-colors hover:bg-muted/30"
    >
      <td className={cn(cellCls, 'text-xs tabular-nums text-muted-foreground')}>{idx + 1}</td>
      <td className={cellCls}>
        <div className="truncate text-sm font-semibold leading-snug text-foreground" title={item.model}>
          {item.model || 'ไม่ระบุรุ่น'}
        </div>
        <div className="mt-1">
          {isTablet ? (
            <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">แท็บเล็ต</span>
          ) : (
            <ChipGroup label="สภาพ" hideLabel options={CONDITION} value={item.category} onChange={(v) => onChange('category', v)} />
          )}
        </div>
        {!info && (
          <p className="mt-1 text-2xs leading-snug text-muted-foreground">ไม่พบรุ่นในแคตตาล็อก — ลบแล้วเพิ่มใหม่</p>
        )}
      </td>
      <td className={cellCls}>
        <CompactSelect
          label="ความจุ"
          placeholder="— ความจุ —"
          options={info?.storage ?? []}
          value={item.storage}
          onChange={(v) => onChange('storage', v)}
          disabled={!info || info.storage.length === 0}
        />
      </td>
      <td className={cellCls}>
        <CompactSelect
          label="สี"
          placeholder="— สี —"
          options={info?.colors ?? []}
          value={item.color}
          onChange={(v) => onChange('color', v)}
          disabled={!info || info.colors.length === 0}
        />
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

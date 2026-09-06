import { Copy, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumberDecimal } from '@/utils/formatters';
import { QtyStepper } from './QtyStepper';

/* Shared table cells so device and accessory rows share the same columns. */

export const cellCls = 'px-2 py-2 align-middle';

export const selectCls =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-hidden ' +
  'focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50';

export const inputCls =
  'h-9 rounded-md border border-input bg-background px-2 text-sm outline-hidden placeholder:text-muted-foreground ' +
  'focus-visible:ring-2 focus-visible:ring-ring/30';

export function CompactSelect({
  label,
  value,
  options,
  placeholder,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(selectCls, className)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** จำนวน · ราคา/ชิ้น · รวม — the three money columns, identical for every row type. */
export function MoneyCells({
  quantity,
  unitPrice,
  onQuantity,
  onUnitPrice,
}: {
  quantity: string;
  unitPrice: string;
  onQuantity: (v: string) => void;
  onUnitPrice: (v: string) => void;
}) {
  const total = (Number(quantity) || 0) * (Number(unitPrice) || 0);
  return (
    <>
      <td className={cellCls}>
        <QtyStepper value={quantity} onChange={onQuantity} />
      </td>
      <td className={cellCls}>
        <span className="relative block">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">฿</span>
          <input
            aria-label="ราคาต่อชิ้น"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={unitPrice}
            onChange={(e) => onUnitPrice(e.target.value)}
            placeholder="0.00"
            className={cn(inputCls, 'w-full pl-5 pr-1.5 text-right tabular-nums', !unitPrice && 'border-warning/70')}
          />
        </span>
      </td>
      <td className={cn(cellCls, 'text-right')}>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatNumberDecimal(total, 2)}</span>
      </td>
    </>
  );
}

export function ActionsCell({ onDuplicate, onRemove }: { onDuplicate: () => void; onRemove: () => void }) {
  const base =
    'grid size-8 place-items-center rounded-md text-muted-foreground transition-colors cursor-pointer hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40';
  return (
    <td className={cn(cellCls, 'pr-1')}>
      <div className="flex items-center justify-end gap-0.5">
        <button type="button" aria-label="ทำซ้ำรายการ" title="ทำซ้ำ — รุ่นเดิม เปลี่ยนความจุ/สี" onClick={onDuplicate} className={cn(base, 'hover:text-foreground')}>
          <Copy className="size-4" />
        </button>
        <button type="button" aria-label="ลบรายการ" title="ลบรายการ" onClick={onRemove} className={cn(base, 'hover:text-destructive')}>
          <X className="size-4" />
        </button>
      </div>
    </td>
  );
}

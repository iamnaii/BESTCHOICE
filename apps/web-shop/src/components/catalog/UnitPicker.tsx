import type { ProductUnit } from '@/types/product';
import { cn } from '@/lib/utils';

function unitLabel(u: ProductUnit, isNew: boolean): string {
  const parts = [
    !isNew && u.conditionGrade && u.conditionGrade !== 'unknown'
      ? `เกรด ${u.conditionGrade}`
      : null,
    u.color || null,
    !isNew && u.batteryHealth != null ? `แบต ${u.batteryHealth}%` : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'เครื่องนี้';
}

export function UnitPicker({
  units,
  selectedId,
  onSelect,
  isNew,
}: {
  units: ProductUnit[];
  selectedId: string;
  onSelect: (id: string) => void;
  isNew: boolean;
}) {
  if (units.length <= 1) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground leading-snug">
        เลือกเครื่อง ({units.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {units.map((u) => {
          const active = u.id === selectedId;
          return (
            <button
              key={u.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(u.id)}
              className={cn(
                'flex flex-col items-start px-3 py-2 rounded-xl border text-left transition-colors leading-snug',
                active
                  ? 'border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50'
                  : 'border-border hover:border-foreground/40',
              )}
            >
              <span className="text-[13px] font-medium text-foreground">{unitLabel(u, isNew)}</span>
              <span className="num text-sm text-emerald-600 font-semibold">
                {u.cashPrice > 0 ? `฿${u.cashPrice.toLocaleString()}` : 'สอบถามราคา'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

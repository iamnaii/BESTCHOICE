import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { formatNumber } from '@/utils/formatters';
import { formatThaiDateShort } from '@/lib/date';

export interface InstallmentOption {
  id: string;
  installmentNumber: number;
  dueDate: string; // ISO
  remainingAmount: number;
  daysOverdue: number;
}

interface Props {
  open: boolean;
  installments: InstallmentOption[];
  selectedIds: string[];
  onChange: (ids: string[], totalAmount: number) => void;
  onClose: () => void;
}

export default function InstallmentPickerPopover({
  open,
  installments,
  selectedIds,
  onChange,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<string[]>(selectedIds);

  // M8 fix: resync draft from props every time the popover opens or when the
  // parent's selectedIds prop changes. The component returns null when closed
  // rather than unmounting, so the original useState initializer only ran once
  // and stale draft survived across reopens with different selections.
  useEffect(() => {
    if (open) setDraft(selectedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedIds.join(',')]);

  if (!open) return null;

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function apply() {
    const total = installments
      .filter((i) => draft.includes(i.id))
      .reduce((acc, i) => acc + i.remainingAmount, 0);
    onChange(draft, total);
    onClose();
  }

  return (
    <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold leading-snug">เลือกงวดที่นัดจ่าย</div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted" aria-label="ปิด">
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1">
        {installments.length === 0 && (
          <div className="text-sm text-muted-foreground leading-snug py-2">ไม่มีงวดที่ค้างอยู่</div>
        )}
        {installments.map((i) => {
          const selected = draft.includes(i.id);
          const dateLabel = formatThaiDateShort(i.dueDate);
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => toggle(i.id)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                selected ? 'border-primary bg-primary/10' : 'border-input bg-card hover:bg-muted'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`size-4 rounded border flex items-center justify-center ${
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                  }`}
                >
                  {selected && <Check className="size-3" />}
                </div>
                <div className="text-sm leading-snug">
                  <div className="font-medium">
                    งวดที่ {i.installmentNumber} — {dateLabel}
                  </div>
                  <div className="text-xs text-muted-foreground">ค้าง {i.daysOverdue} วัน</div>
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {formatNumber(i.remainingAmount)} ฿
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 justify-end pt-3 mt-2 border-t border-border/40">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-muted"
        >
          ยกเลิก
        </button>
        <button
          onClick={apply}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90"
        >
          ใช้
        </button>
      </div>
    </div>
  );
}

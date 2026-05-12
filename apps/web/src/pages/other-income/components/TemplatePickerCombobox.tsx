import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { otherIncomeApi } from '@/lib/otherIncome';

interface Props {
  onApply: (resolvedItems: any[], priceType: 'EXCLUSIVE' | 'INCLUSIVE') => void;
}

export function TemplatePickerCombobox({ onApply }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const query = useQuery({
    queryKey: ['other-income-templates-picker'],
    queryFn: () => otherIncomeApi.templates.list(),
    enabled: open,
  });
  const applyTemplateMutation = useMutation({
    mutationFn: (id: string) => otherIncomeApi.templates.use(id),
    onSuccess: (data) => {
      onApply(data.items, data.priceType);
      setOpen(false);
    },
  });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-3 py-1.5 border rounded-md text-xs hover:bg-accent"
      >
        ใช้ template <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-72 max-h-72 overflow-auto border rounded-md bg-popover shadow-lg">
          {(query.data ?? []).map((t: any) => (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTemplateMutation.mutate(t.id)}
              className="w-full text-left px-3 py-2 hover:bg-accent text-xs"
            >
              <div className="font-semibold">{t.name}</div>
              <div className="text-muted-foreground">
                {t.itemsJson?.length ?? 0} รายการ · ใช้ {t.useCount} ครั้ง
              </div>
            </button>
          ))}
          {query.data?.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">ไม่มี template</div>
          )}
          {query.isLoading && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">กำลังโหลด...</div>
          )}
        </div>
      )}
    </div>
  );
}

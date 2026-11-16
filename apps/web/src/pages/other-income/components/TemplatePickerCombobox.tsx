import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { otherIncomeApi } from '@/lib/otherIncome';

interface Props {
  onApply: (resolvedItems: any[], priceType: 'EXCLUSIVE' | 'INCLUSIVE') => void;
}

/**
 * The "use a template" button of section 2 — a command menu: each row applies a template, it is not
 * a value picker (spec §6.4). The panel is a portalled Radix Popover aligned to the button's end, so it
 * stays on screen next to the right-hand button at every width (owner 2026-11-16 — the old inline
 * `absolute` panel ran past the right edge at 1024 and 390). Esc, a click elsewhere and focus return
 * come from Radix. (No Thai button text in this comment: tabsButtonRowsNowrap.test.ts finds the
 * button by the first occurrence of its label.)
 */
export function TemplatePickerCombobox({ onApply }: Props) {
  const [open, setOpen] = useState(false);

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-ui-control="button"
          type="button"
          className="inline-flex items-center gap-1 whitespace-nowrap px-3 py-1.5 border rounded-md text-xs hover:bg-accent"
        >
          ใช้แม่แบบ <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        aria-label="แม่แบบรายได้"
        className="w-72 max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto overscroll-contain p-0"
      >
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
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">ไม่มี แม่แบบ</div>
        )}
        {query.isLoading && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">กำลังโหลด...</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

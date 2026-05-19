import { HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TAX_DISALLOWED_CATEGORIES } from '@/constants/tax-disallowed';

interface Props {
  /** Compact variant for line-level usage; default = doc-level richer style */
  compact?: boolean;
}

/**
 * Owner Response v2.0 Bonus B2 (2026-05-17): inline category list for
 * the tax-disallowed flag, so users see which ม.65 ตรี sub-clause their
 * expense falls under BEFORE ticking the checkbox. Click the small "?"
 * icon to open a Popover with the 12 most common categories. Selecting
 * a category does NOT modify form state — it's a reference list only;
 * ภ.ง.ด.50/51 still keys off the boolean flag.
 */
export default function TaxDisallowedHint({ compact = false }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="ดูประเภทค่าใช้จ่ายต้องห้าม (ม.65 ตรี)"
          className={`inline-flex items-center gap-1 rounded-md text-muted-foreground transition-colors hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30 ${
            compact ? 'p-0.5 text-[11px]' : 'px-1.5 py-0.5 text-xs'
          }`}
        >
          <HelpCircle className={compact ? 'size-3' : 'size-3.5'} aria-hidden="true" />
          {!compact && <span>ดูตัวอย่างประเภท</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(28rem,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto p-0"
      >
        <div className="sticky top-0 border-b border-border bg-popover/95 backdrop-blur-xs px-4 py-3">
          <h4 className="text-sm font-semibold leading-snug text-foreground">
            ประเภทค่าใช้จ่ายต้องห้าม (ม.65 ตรี ป.รัษฎากร)
          </h4>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            ติ๊กเลือกเฉพาะรายการที่หักลดหย่อนภาษีนิติบุคคลไม่ได้ — ตัวอย่างที่พบบ่อย
          </p>
        </div>
        <ul className="divide-y divide-border">
          {TAX_DISALLOWED_CATEGORIES.map((c) => (
            <li key={c.ref} className="px-4 py-2.5 text-xs leading-snug">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-muted-foreground shrink-0 pt-0.5">
                  ม.65 ตรี {c.ref}
                </span>
                <div className="flex-1">
                  <div className="font-medium text-foreground">{c.label}</div>
                  {c.example && (
                    <div className="mt-0.5 text-muted-foreground">{c.example}</div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-border bg-muted/30 px-4 py-2.5 text-[11px] leading-snug text-muted-foreground">
          ระบบบันทึกบัญชีปกติ — flag นี้มีผลเฉพาะตอนสรุปยอด ภ.ง.ด.50/51 ปลายปี
        </div>
      </PopoverContent>
    </Popover>
  );
}

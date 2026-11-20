import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formLabelClass } from '@/components/ui/form-styles';

/** การ์ดหัวข้อมีเลขลำดับ — เรียงตามขั้นที่พนักงานทำจริง (ประเภท → รุ่น → ตัวเครื่อง → ประกัน → รูป → รับเข้าคลัง) */
export default function FormSection({
  number,
  title,
  subtitle,
  children,
}: {
  number?: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl bg-card text-card-foreground shadow-sm shadow-black/5 dark:border dark:border-border"
    >
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        {number != null && (
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
          >
            {number}
          </span>
        )}
        <div className="min-w-0 pt-0.5">
          <h2 id={headingId} className="text-base font-semibold leading-snug text-foreground">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export interface SegmentOption {
  value: string;
  label: string;
}

/** ปุ่มเลือกแบบแถบ (เลือกได้ค่าเดียว) — ชื่อกลุ่มคือป้ายด้านบน แต่ละปุ่มบอกสถานะด้วย aria-pressed */
export function SegmentedChoice({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={hint ? `${id}-hint` : undefined}
    >
      <span id={`${id}-label`} className={formLabelClass}>
        {label}
      </span>
      <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
        {options.map((opt) => {
          const on = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(opt.value)}
              className={cn(
                'min-h-11 flex-1 rounded-md px-3 text-sm leading-snug transition-colors lg:min-h-10',
                on
                  ? 'bg-card font-semibold text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

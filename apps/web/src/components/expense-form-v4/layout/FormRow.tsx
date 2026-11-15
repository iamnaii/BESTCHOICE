import { useId, type ReactNode } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  /** side = ป้ายซ้าย (จอ ≥ lg) · stacked = ป้ายบน เนื้อหากว้างเต็ม (ตาราง) */
  layout?: 'side' | 'stacked';
  /** ไม่ส่ง = ไม่มีเครื่องหมาย · สถานะนี้ซ้ำกับบรรทัด "พร้อมบันทึก" ในแถบล่าง จึงซ่อนจาก screen reader */
  complete?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

export function FormRow({ title, layout = 'side', complete, action, children }: Props) {
  const headingId = useId();
  const Mark = complete ? CheckCircle2 : Circle;
  return (
    <section
      aria-labelledby={headingId}
      className={cn('border-t border-border py-5', layout === 'side' && 'lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6')}
    >
      <div className={cn('mb-3 flex items-center justify-between gap-3', layout === 'side' && 'lg:mb-0 lg:items-start')}>
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold leading-snug">
          {complete !== undefined && (
            <Mark className={cn('size-4 shrink-0', complete ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
          )}
          {title}
        </h3>
        {action}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export default function DateRangeField({
  from,
  to,
  onFromChange,
  onToChange,
  className,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <fieldset className={cn('grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2', className)}>
      <legend className="sr-only">ช่วงวันที่</legend>
      <div className="min-w-0">
        <label htmlFor={`${id}-from`} className="mb-1 block text-xs text-muted-foreground">
          วันที่เริ่ม
        </label>
        <Input
          id={`${id}-from`}
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => onFromChange(e.target.value)}
          className="w-full min-w-0"
        />
      </div>
      <div className="min-w-0">
        <label htmlFor={`${id}-to`} className="mb-1 block text-xs text-muted-foreground">
          วันที่สิ้นสุด
        </label>
        <Input
          id={`${id}-to`}
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => onToChange(e.target.value)}
          className="w-full min-w-0"
        />
      </div>
    </fieldset>
  );
}

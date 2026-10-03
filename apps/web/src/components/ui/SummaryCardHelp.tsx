import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export default function SummaryCardHelp({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <span className="print:hidden">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${label}: ${title}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {label}
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-w-[calc(100vw-2rem)] text-sm print:hidden"
            aria-label={title}
          >
            <p className="font-medium">{title}</p>
            <div className="mt-2 text-muted-foreground">{children}</div>
          </PopoverContent>
        </Popover>
      </span>
      <span className="hidden print:inline">{children}</span>
    </>
  );
}

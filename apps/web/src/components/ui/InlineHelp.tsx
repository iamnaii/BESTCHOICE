import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Optional instructions only. Keep warnings and transaction conditions outside. */
export default function InlineHelp({
  label = 'รายละเอียดเพิ่มเติม',
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn('group min-w-0 text-sm leading-relaxed', className)}>
      <summary className="flex min-h-11 w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <ChevronDown className="size-3.5 shrink-0 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="max-w-prose border-l-2 border-border py-1 pl-3 text-muted-foreground break-words [&>p+p]:mt-2">
        {children}
      </div>
    </details>
  );
}

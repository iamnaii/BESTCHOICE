import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared screen inset; paper components retain their own print dimensions. */
export default function PageShell({
  children,
  kind = 'data',
}: {
  children: ReactNode;
  kind?: 'data' | 'form' | 'report';
}) {
  return (
    <div
      data-page-shell={kind}
      className="container-fluid min-w-0 px-4 lg:px-7 pt-0 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pb-8 animate-fadeIn"
    >
      <div className={cn('min-w-0', kind === 'form' && 'mx-auto w-full max-w-6xl')}>{children}</div>
    </div>
  );
}

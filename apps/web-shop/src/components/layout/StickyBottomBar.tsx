import { cn } from '@/lib/utils';

export function StickyBottomBar({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'md:hidden fixed inset-x-0 bottom-0 z-30',
        'bg-background/95 backdrop-blur border-t border-zinc-200',
        'px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Use inside page layouts to reserve space for the fixed bar so content
    isn't hidden behind it on mobile. */
export function StickyBottomBarSpacer() {
  return <div className="md:hidden h-20" aria-hidden="true" />;
}

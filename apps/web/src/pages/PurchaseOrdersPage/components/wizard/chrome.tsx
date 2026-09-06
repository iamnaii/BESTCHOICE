import { cn } from '@/lib/utils';

/** Shared chrome for the summary-style cards (PO wizard step 3, รับเข้าตรง step 3, approve dialog). */
export const card = 'rounded-xl border border-border/50 bg-card p-5 shadow-sm';
export const fieldCls =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-hidden placeholder:text-muted-foreground ' +
  'focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50';
export const moneyInput =
  'h-9 w-36 rounded-md border border-input bg-background px-2 text-right font-mono text-sm tabular-nums outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30';
export const labelCls = 'mb-1 block text-xs leading-snug text-muted-foreground';

export function CardHeader({ icon, title, hint, tone }: { icon: React.ReactNode; title: string; hint: string; tone: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <div className={cn('flex size-8 items-center justify-center rounded-lg', tone)}>{icon}</div>
      <div>
        <h3 className="text-sm font-semibold leading-snug text-foreground">{title}</h3>
        <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

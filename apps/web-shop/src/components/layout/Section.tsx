import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'muted' | 'emerald' | 'sand';
  padding?: 'sm' | 'md' | 'lg';
}
const toneClass = {
  default: '',
  // Mint tint (--color-mint-tint, owner brief 2026-11-27 A4) — the alternating section
  // background (white / mint / white) instead of the old pale navy; white cards sitting on
  // it get their separation from the tint, not from shadow alone.
  // 'emerald' keeps the brand-mint tint for a deliberate green section (unused today).
  muted: 'bg-mint-tint',
  emerald: 'bg-emerald-50',
  sand: 'bg-sand-50',
};
const padClass = { sm: 'py-8 md:py-10', md: 'py-12 md:py-16', lg: 'py-16 md:py-24' };

export function Section({ tone = 'default', padding = 'md', className, ...props }: Props) {
  return <section className={cn(toneClass[tone], padClass[padding], className)} {...props} />;
}

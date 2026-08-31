import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'muted' | 'emerald' | 'sand';
  padding?: 'sm' | 'md' | 'lg';
}
const toneClass = {
  default: '',
  // Full mint-tint (#E8FAF4) — the guide's section background; white cards
  // sitting on it get their separation from the tint, not from shadow alone.
  muted: 'bg-muted',
  emerald: 'bg-emerald-50',
  sand: 'bg-sand-50',
};
const padClass = { sm: 'py-8 md:py-10', md: 'py-12 md:py-16', lg: 'py-16 md:py-24' };

export function Section({ tone = 'default', padding = 'md', className, ...props }: Props) {
  return <section className={cn(toneClass[tone], padClass[padding], className)} {...props} />;
}

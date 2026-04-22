import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  gap?: 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16;
}
const gapClass = {
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  6: 'gap-6',
  8: 'gap-8',
  12: 'gap-12',
  16: 'gap-16',
} as const;

export function Stack({ gap = 4, className, ...props }: Props) {
  return <div className={cn('flex flex-col', gapClass[gap], className)} {...props} />;
}

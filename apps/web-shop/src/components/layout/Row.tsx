import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  gap?: 1 | 2 | 3 | 4 | 6 | 8;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
}
const gapClass = { 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8' };

export function Row({
  gap = 4,
  align = 'center',
  justify = 'start',
  wrap,
  className,
  ...props
}: Props) {
  return (
    <div
      className={cn(
        'flex',
        `items-${align}`,
        `justify-${justify}`,
        gapClass[gap],
        wrap && 'flex-wrap',
        className,
      )}
      {...props}
    />
  );
}

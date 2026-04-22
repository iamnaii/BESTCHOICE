import { Children, cloneElement, isValidElement } from 'react';
import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  stagger?: number;
}

export function StaggerChildren({ stagger: _stagger = 50, className, children, ...props }: Props) {
  return (
    <div className={cn('stagger', className)} {...props}>
      {Children.map(children, (child, i) => (
        <div style={{ ['--stagger-index' as string]: i } as React.CSSProperties}>
          {isValidElement(child) ? cloneElement(child) : child}
        </div>
      ))}
    </div>
  );
}

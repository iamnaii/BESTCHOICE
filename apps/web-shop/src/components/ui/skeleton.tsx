import * as React from 'react';
import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  /** Pre-shaped variants for common use cases. */
  shape?: 'line' | 'avatar' | 'card' | 'thumbnail' | 'custom';
}

export function Skeleton({ shape = 'custom', className, ...props }: Props) {
  const shapeClass = {
    line: 'h-4 w-full rounded-md',
    avatar: 'h-10 w-10 rounded-full',
    card: 'h-40 w-full rounded-2xl',
    thumbnail: 'aspect-square w-full rounded-xl',
    custom: '',
  }[shape];
  return (
    <div
      className={cn(
        'animate-pulse bg-zinc-100 dark:bg-zinc-800',
        shapeClass,
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

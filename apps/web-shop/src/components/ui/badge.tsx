import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-medium leading-snug whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-zinc-100 text-zinc-800',
        primary: 'bg-emerald-100 text-emerald-900',
        success: 'bg-emerald-500 text-white',
        warning: 'bg-amber-100 text-amber-900',
        danger: 'bg-red-100 text-red-900',
        outline: 'bg-transparent border border-zinc-300 text-zinc-700',
        'condition-a': 'bg-emerald-500 text-white',
        'condition-b': 'bg-amber-500 text-white',
        'condition-c': 'bg-orange-500 text-white',
      },
      size: {
        sm: 'text-xs px-2 py-0.5',
        md: 'text-xs px-2.5 py-1',
        lg: 'text-sm px-3 py-1',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { badgeVariants };

import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const textareaVariants = cva(
  `
    w-full bg-background border border-input text-foreground shadow-xs shadow-black/5 transition-[color,box-shadow]
    placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:outline-hidden focus-visible:ring-[3px]
    focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50
  `,
  {
    variants: {
      variant: {
        sm: 'px-2.5 py-2.5 text-xs rounded-md',
        md: 'px-3 py-3 text-sm rounded-md',
        lg: 'px-4 py-4 text-sm rounded-md',
      },
    },
    defaultVariants: {
      variant: 'md',
    },
  },
);

function Textarea({
  className,
  variant,
  ...props
}: React.ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>) {
  return <textarea data-slot="textarea" className={cn(textareaVariants({ variant }), className)} {...props} />;
}

export { Textarea, textareaVariants };

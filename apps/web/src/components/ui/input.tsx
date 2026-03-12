import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const inputVariants = cva(
  `
    flex w-full bg-background border border-input shadow-sm shadow-black/5 transition-[color,box-shadow] text-foreground placeholder:text-muted-foreground/80
    focus-visible:ring-ring/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px]
    disabled:cursor-not-allowed disabled:opacity-60
    [&[readonly]]:bg-muted/80 [&[readonly]]:cursor-not-allowed
    file:h-full [&[type=file]]:py-0 file:border-solid file:border-input file:bg-transparent
    file:font-medium file:not-italic file:text-foreground file:p-0 file:border-0 file:border-r
    aria-invalid:border-destructive/60 aria-invalid:ring-destructive/10 dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/20
  `,
  {
    variants: {
      variant: {
        lg: 'h-10 px-4 text-sm rounded-md file:pr-4 file:mr-4',
        md: 'h-[34px] px-3 text-[0.8125rem] leading-snug rounded-md file:pr-3 file:mr-3',
        sm: 'h-7 px-2.5 text-xs rounded-md file:pr-2.5 file:mr-2.5',
      },
    },
    defaultVariants: {
      variant: 'md',
    },
  },
);

const inputAddonVariants = cva(
  'flex items-center shrink-0 justify-center bg-muted border border-input shadow-sm shadow-black/5 text-secondary-foreground [&_svg]:text-secondary-foreground/60',
  {
    variants: {
      variant: {
        sm: 'rounded-md h-7 min-w-[28px] text-xs px-2.5 [&_svg:not([class*=size-])]:size-3.5',
        md: 'rounded-md h-[34px] min-w-[34px] px-3 text-[0.8125rem] leading-snug [&_svg:not([class*=size-])]:size-[18px]',
        lg: 'rounded-md h-10 min-w-[40px] px-4 text-sm [&_svg:not([class*=size-])]:size-[18px]',
      },
      mode: {
        default: '',
        icon: 'px-0 justify-center',
      },
    },
    defaultVariants: {
      variant: 'md',
      mode: 'default',
    },
  },
);

const inputGroupVariants = cva(
  `
    flex items-stretch
    [&_[data-slot=input]]:grow
    [&_[data-slot=input-addon]:has(+[data-slot=input])]:rounded-r-none [&_[data-slot=input-addon]:has(+[data-slot=input])]:border-r-0
    [&_[data-slot=input]+[data-slot=input-addon]]:rounded-l-none [&_[data-slot=input]+[data-slot=input-addon]]:border-l-0
    [&_[data-slot=input-addon]:has(+[data-slot=button])]:rounded-r-none
    [&_[data-slot=input]+[data-slot=button]]:rounded-l-none
    [&_[data-slot=button]+[data-slot=input]]:rounded-l-none
    [&_[data-slot=input-addon]+[data-slot=input]]:rounded-l-none
    [&_[data-slot=input]:has(+[data-slot=button])]:rounded-r-none
    [&_[data-slot=input]:has(+[data-slot=input-addon])]:rounded-r-none
  `,
  {
    variants: {},
    defaultVariants: {},
  },
);

const inputWrapperVariants = cva(
  `
    flex items-center gap-1.5
    has-[:focus-visible]:ring-ring/30
    has-[:focus-visible]:border-ring
    has-[:focus-visible]:outline-none
    has-[:focus-visible]:ring-[3px]

    [&_[data-slot=input]]:flex
    [&_[data-slot=input]]:w-full
    [&_[data-slot=input]]:outline-none
    [&_[data-slot=input]]:transition-colors
    [&_[data-slot=input]]:text-foreground
    [&_[data-slot=input]]:placeholder:text-muted-foreground
    [&_[data-slot=input]]:border-0
    [&_[data-slot=input]]:bg-transparent
    [&_[data-slot=input]]:p-0
    [&_[data-slot=input]]:shadow-none
    [&_[data-slot=input]]:focus-visible:ring-0
    [&_[data-slot=input]]:h-auto
    [&_[data-slot=input]]:disabled:cursor-not-allowed
    [&_[data-slot=input]]:disabled:opacity-50

    [&_svg]:text-muted-foreground
    [&_svg]:shrink-0
  `,
  {
    variants: {
      variant: {
        sm: 'gap-[5px] [&_svg:not([class*=size-])]:size-3.5',
        md: 'gap-1.5 [&_svg:not([class*=size-])]:size-4',
        lg: 'gap-1.5 [&_svg:not([class*=size-])]:size-4',
      },
    },
    defaultVariants: {
      variant: 'md',
    },
  },
);

function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<'input'> & VariantProps<typeof inputVariants>) {
  return <input data-slot="input" type={type} className={cn(inputVariants({ variant }), className)} {...props} />;
}

function InputAddon({
  className,
  variant,
  mode,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputAddonVariants>) {
  return <div data-slot="input-addon" className={cn(inputAddonVariants({ variant, mode }), className)} {...props} />;
}

function InputGroup({ className, ...props }: React.ComponentProps<'div'> & VariantProps<typeof inputGroupVariants>) {
  return <div data-slot="input-group" className={cn(inputGroupVariants(), className)} {...props} />;
}

function InputWrapper({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputWrapperVariants>) {
  return (
    <div
      data-slot="input-wrapper"
      className={cn(inputVariants({ variant }), inputWrapperVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Input, InputAddon, InputGroup, InputWrapper, inputVariants, inputAddonVariants };

import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import * as SwitchPrimitive from '@radix-ui/react-switch';

const SwitchContext = React.createContext<{ permanent: boolean }>({
  permanent: false,
});

const useSwitchContext = () => {
  const context = React.useContext(SwitchContext);
  if (!context) {
    throw new Error('SwitchIndicator must be used within a Switch component');
  }
  return context;
};

const switchVariants = cva(
  `
    relative peer inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors
    focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
    disabled:cursor-not-allowed disabled:opacity-50 data-[state=unchecked]:bg-input
  `,
  {
    variants: {
      shape: {
        pill: 'rounded-full',
        square: 'rounded-md',
      },
      size: {
        sm: 'h-5 w-8',
        md: 'h-6 w-10',
        lg: 'h-8 w-14',
        xl: 'h-9 w-16',
      },
      permanent: {
        true: 'bg-input',
        false: 'data-[state=checked]:bg-primary',
      },
    },
    defaultVariants: {
      shape: 'pill',
      permanent: false,
      size: 'md',
    },
  },
);

const switchThumbVariants = cva(
  'pointer-events-none block bg-white w-1/2 h-[calc(100%-4px)] shadow-lg ring-0 transition-transform start-0 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[calc(100%-2px)] rtl:data-[state=unchecked]:-translate-x-[2px] rtl:data-[state=checked]:-translate-x-[calc(100%-2px)]',
  {
    variants: {
      shape: {
        pill: 'rounded-full',
        square: 'rounded-md',
      },
      size: {
        sm: '',
        md: '',
        lg: '',
        xl: '',
      },
    },
    defaultVariants: {
      shape: 'pill',
      size: 'md',
    },
  },
);

function SwitchWrapper({
  className,
  children,
  permanent = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { permanent?: boolean }) {
  return (
    <SwitchContext.Provider value={{ permanent }}>
      <div data-slot="switch-wrapper" className={cn('relative inline-flex items-center', className)} {...props}>
        {children}
      </div>
    </SwitchContext.Provider>
  );
}

function Switch({
  className,
  thumbClassName = '',
  shape,
  size,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> &
  VariantProps<typeof switchVariants> & { thumbClassName?: string }) {
  const context = useSwitchContext();
  const permanent = context?.permanent ?? false;

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(switchVariants({ shape, size, permanent }), className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className={cn(switchThumbVariants({ shape, size }), thumbClassName)} />
    </SwitchPrimitive.Root>
  );
}

export { Switch, SwitchWrapper };

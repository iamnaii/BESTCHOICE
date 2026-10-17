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
    relative peer group/switch inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full
    h-(--switch-height) w-(--switch-width) max-lg:min-h-11 max-lg:min-w-11
    focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
    disabled:cursor-not-allowed disabled:opacity-50
  `,
  {
    variants: {
      shape: {
        pill: 'rounded-full',
        square: 'rounded-md',
      },
      size: {
        sm: '[--switch-height:1.25rem] [--switch-width:2rem]',
        md: '[--switch-height:1.5rem] [--switch-width:2.5rem]',
        lg: '[--switch-height:2rem] [--switch-width:3.5rem]',
        xl: '[--switch-height:2.25rem] [--switch-width:4rem]',
      },
      permanent: {
        true: '',
        false: '',
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
  'pointer-events-none block bg-background w-1/2 h-[calc(100%-4px)] shadow-lg ring-0 transition-transform inset-s-0 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:rtl:-translate-x-[2px] data-[state=checked]:rtl:-translate-x-[calc(100%-2px)]',
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
      <span
        data-slot="switch-track"
        className={cn(
          'pointer-events-none relative flex shrink-0 items-center h-(--switch-height) w-(--switch-width) bg-input transition-colors',
          shape === 'square' ? 'rounded-md' : 'rounded-full',
          !permanent && 'group-data-[state=checked]/switch:bg-primary',
        )}
      >
        <SwitchPrimitive.Thumb className={cn(switchThumbVariants({ shape, size }), thumbClassName)} />
      </span>
    </SwitchPrimitive.Root>
  );
}

export { Switch, SwitchWrapper };

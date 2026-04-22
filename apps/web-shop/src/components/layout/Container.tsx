import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  narrow?: boolean;
}

export function Container({ size = 'xl', narrow, className, ...props }: Props) {
  const max = narrow
    ? 'max-w-xl'
    : {
        sm: 'max-w-2xl',
        md: 'max-w-4xl',
        lg: 'max-w-5xl',
        xl: 'max-w-7xl',
        full: 'max-w-none',
      }[size];
  return <div className={cn('mx-auto w-full px-4 md:px-6', max, className)} {...props} />;
}

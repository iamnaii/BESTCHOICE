import * as React from 'react';
import { cn } from '@/lib/utils';

type CardVariant = 'plain' | 'elevated' | 'outlined' | 'interactive';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantClass: Record<CardVariant, string> = {
  plain: 'bg-card',
  elevated: 'bg-card shadow-md',
  outlined: 'bg-card border border-zinc-200',
  interactive:
    'bg-card border border-zinc-200 hover:shadow-lg hover:border-emerald-200 transition-all duration-base cursor-pointer',
};

export function Card({ variant = 'outlined', className, ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-2xl overflow-hidden', variantClass[variant], className)}
      data-slot="card"
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 md:p-6 border-b border-zinc-200', className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 md:p-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('p-4 md:p-6 border-t border-zinc-200 bg-zinc-50', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-xl font-semibold leading-snug', className)} {...props} />;
}

// Backward-compat aliases for any existing callers that imported the
// Metronic-style slot names (CardContent/CardDescription/etc.). None
// exist in apps/web-shop today, but exports are preserved to keep the
// public API additive.
export const CardContent = CardBody;

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('text-sm text-muted-foreground leading-snug', className)}
      {...props}
    />
  );
}

export function CardHeading({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-1', className)} {...props} />;
}

export function CardToolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2.5', className)} {...props} />;
}

export function CardTable({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid grow', className)} {...props} />;
}

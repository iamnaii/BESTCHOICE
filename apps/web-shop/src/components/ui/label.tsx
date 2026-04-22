import * as React from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  help?: React.ReactNode;
  error?: React.ReactNode;
}

export function Label({ className, required, help, error, children, ...props }: LabelProps) {
  return (
    <div className="space-y-1">
      <label
        className={cn(
          'text-sm font-medium text-foreground leading-snug inline-flex items-center gap-1',
          className,
        )}
        {...props}
      >
        {children}
        {required && <span className="text-destructive" aria-hidden="true">*</span>}
      </label>
      {help && !error && (
        <p className="text-xs text-muted-foreground leading-snug">{help}</p>
      )}
      {error && (
        <p className="text-xs text-destructive leading-snug" role="alert">{error}</p>
      )}
    </div>
  );
}

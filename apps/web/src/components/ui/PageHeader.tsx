import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import InlineHelp from './InlineHelp';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional background instructions; essential conditions belong in the visible page. */
  help?: ReactNode;
  helpLabel?: string;
  icon?: ReactNode;
  action?: ReactNode;
  breadcrumb?: ReactNode;
  /** Kept for backwards compatibility — ignored, always renders plain header. */
  gradient?: boolean;
  /** Back button handler — shows ← button when provided */
  onBack?: () => void;
  /** Status badge next to title */
  badge?: ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  help,
  helpLabel,
  icon,
  action,
  breadcrumb,
  onBack,
  badge,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('min-w-0 flex flex-col gap-3 py-5 mb-5 border-b border-border', className)}>
      {breadcrumb}
      <div className="flex min-w-0 items-start justify-between flex-wrap gap-3">
        <div className="flex min-w-0 max-w-full items-start gap-3">
          {onBack && (
            <button data-ui-control="button" data-ui-icon="true"
              onClick={onBack}
              className="flex items-center justify-center size-11 shrink-0 rounded-md hover:bg-accent text-muted-foreground transition-colors"
              aria-label="กลับ"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          {icon && (
            <div className="flex items-center justify-center size-9 rounded-lg bg-primary/10 text-primary shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="text-[1.375rem] lg:text-2xl leading-snug font-semibold text-foreground break-words">
                {title}
              </h1>
              {badge}
            </div>
            {subtitle && (
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground break-words">
                {subtitle}
              </p>
            )}
            {help && <InlineHelp label={helpLabel}>{help}</InlineHelp>}
          </div>
        </div>
        {action && (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2.5">{action}</div>
        )}
      </div>
    </div>
  );
}

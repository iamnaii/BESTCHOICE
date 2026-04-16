import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
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
  icon,
  action,
  breadcrumb,
  onBack,
  badge,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-2 py-5 mb-5 border-b border-border', className)}>
      {breadcrumb}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center justify-center size-9 rounded-md hover:bg-accent text-muted-foreground transition-colors"
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
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">{title}</h1>
              {badge}
            </div>
            {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex items-center gap-2.5">{action}</div>}
      </div>
    </div>
  );
}

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
    <div className={cn('flex flex-col gap-2 pb-6 lg:pb-7.5', className)}>
      {breadcrumb}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-start gap-2.5">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center justify-center size-8 mt-0.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
              aria-label="กลับ"
            >
              <svg
                width="16"
                height="16"
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
          {icon && <span className="mt-1 shrink-0">{icon}</span>}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-foreground leading-tight">{title}</h1>
              {badge}
            </div>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex items-center gap-2.5">{action}</div>}
      </div>
    </div>
  );
}

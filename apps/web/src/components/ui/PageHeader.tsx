import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  breadcrumb?: ReactNode;
  /** Show gradient banner (default true). Set false for plain style. */
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
  gradient = true,
  onBack,
  badge,
  className,
}: PageHeaderProps) {
  if (!gradient) {
    // Plain header (legacy compatibility)
    return (
      <div className={cn('flex flex-col gap-2 pb-6 lg:pb-7.5', className)}>
        {breadcrumb}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            {icon}
            <div>
              <h1 className="text-xl font-bold text-foreground">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="flex items-center gap-2.5">{action}</div>}
        </div>
      </div>
    );
  }

  // Gradient banner
  return (
    <div
      className={cn(
        'bg-gradient-to-r from-[#1e3a5f] via-[#234b73] to-[#059669]',
        'px-6 lg:px-8 py-5 lg:py-6 -mx-5 lg:-mx-7 -mt-5 mb-6',
        'text-white',
        className,
      )}
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center justify-center size-8 rounded-md bg-white/10 border border-white/15 hover:bg-white/20 transition-colors"
              aria-label="กลับ"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          {icon}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl lg:text-[22px] font-bold">{title}</h1>
              {badge}
            </div>
            {subtitle && (
              <p className="text-sm text-white/60 mt-1">{subtitle}</p>
            )}
          </div>
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

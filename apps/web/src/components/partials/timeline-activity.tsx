import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimelineItemProps {
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  description?: string;
  timestamp: string;
  isLast?: boolean;
  children?: React.ReactNode;
}

export function TimelineItem({
  icon: Icon,
  iconClassName,
  title,
  description,
  timestamp,
  isLast = false,
  children,
}: TimelineItemProps) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary',
            iconClassName,
          )}
        >
          <Icon className="size-4" />
        </div>
        {!isLast && <div className="w-px grow bg-border" />}
      </div>
      <div className={cn('pb-6', isLast && 'pb-0')}>
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <p className="text-xs text-muted-foreground">{timestamp}</p>
        {children}
      </div>
    </div>
  );
}

interface TimelineProps {
  children: React.ReactNode;
  className?: string;
}

export function Timeline({ children, className }: TimelineProps) {
  return <div className={cn('flex flex-col', className)}>{children}</div>;
}

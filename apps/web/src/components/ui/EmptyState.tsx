import { type LucideIcon, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * Empty state illustration — Metronic style
 * ใช้เมื่อหน้าหรือ section ไม่มีข้อมูลแสดง
 */
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-6 text-center', className)}>
      {/* Icon circle */}
      <div className="size-16 rounded-2xl bg-[#f0f5ff] flex items-center justify-center mb-5">
        <Icon className="size-7 text-muted-foreground/60" />
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold text-foreground mb-1">{title}</h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-muted-foreground max-w-md">{description}</p>
      )}

      {/* Action button */}
      {actionLabel && onAction && (
        <Button variant="primary" size="md" onClick={onAction} className="mt-5">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

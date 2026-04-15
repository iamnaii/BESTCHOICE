import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { LucideIcon } from 'lucide-react';
import type { StatusConfig } from '@/lib/status-badges';
import { cn } from '@/lib/utils';

interface StatusCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  status?: StatusConfig;
  trend?: { value: number; label: string };
  className?: string;
}

export function StatusCard({ title, value, icon: Icon, status, trend, className }: StatusCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-semibold">{value}</p>
            {trend && (
              <p className={cn('text-xs', trend.value >= 0 ? 'text-success' : 'text-destructive')}>
                {trend.value >= 0 ? '+' : ''}
                {trend.value}% {trend.label}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-lg bg-secondary p-2">
              <Icon className="size-5 text-muted-foreground" />
            </div>
            {status && (
              <Badge variant={status.variant} appearance={status.appearance} size="sm">
                {status.label}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

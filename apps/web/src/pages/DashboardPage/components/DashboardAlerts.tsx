import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardAlert } from '../types';
import { alertIconMap, alertSeverityStyles } from '../types';

interface DashboardAlertsProps {
  alerts: DashboardAlert[];
}

export default function DashboardAlerts({ alerts }: DashboardAlertsProps) {
  const navigate = useNavigate();

  if (alerts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {alerts.map((alert) => {
        const Icon = alertIconMap[alert.type] ?? AlertTriangle;
        const styles = alertSeverityStyles[alert.severity];
        return (
          <div
            key={alert.type}
            role="button"
            tabIndex={0}
            onClick={() => navigate(alert.link)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(alert.link)}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer',
              'hover:-translate-y-0.5 hover:shadow-md transition-all duration-200',
              styles.container,
            )}
          >
            <div className={cn('size-9 rounded-lg flex items-center justify-center shrink-0', styles.icon)}>
              <Icon className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground leading-tight truncate">{alert.message}</p>
              <p className="text-2xs text-muted-foreground mt-0.5">คลิกเพื่อดูรายละเอียด</p>
            </div>
            <span className={cn('text-xs font-bold shrink-0', styles.count)}>{alert.count}</span>
          </div>
        );
      })}
    </div>
  );
}

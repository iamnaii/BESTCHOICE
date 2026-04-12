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
          <button
            key={alert.type}
            type="button"
            onClick={() => navigate(alert.link)}
            aria-label={`${alert.message} (${alert.count} รายการ) — คลิกเพื่อดูรายละเอียด`}
            className={cn(
              'flex items-center gap-3 px-4 py-3.5 rounded-xl border cursor-pointer text-left w-full',
              'hover:-translate-y-0.5 hover:shadow-md transition-all duration-200',
              'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              styles.container,
            )}
          >
            <div className={cn('size-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm', styles.icon)}>
              <Icon className="size-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight truncate">{alert.message}</p>
              <p className="text-2xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <span>ดูรายละเอียด</span>
                <svg className="size-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" /></svg>
              </p>
            </div>
            <span className={cn('text-sm font-bold shrink-0 tabular-nums', styles.count)}>{alert.count}</span>
          </button>
        );
      })}
    </div>
  );
}

import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  breadcrumb?: ReactNode;
}

export default function PageHeader({ title, subtitle, icon, action, breadcrumb }: PageHeaderProps) {
  return (
    <div data-testid="page-header" className="flex flex-col gap-2 pb-6 lg:pb-7.5">
      {breadcrumb}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col justify-center gap-1.5">
          <div className="flex items-center gap-2.5">
            {icon && <span className="text-primary">{icon}</span>}
            <h1 className="text-xl font-bold leading-none text-foreground">{title}</h1>
          </div>
          {subtitle && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {action && <div className="flex items-center gap-2.5">{action}</div>}
      </div>
    </div>
  );
}

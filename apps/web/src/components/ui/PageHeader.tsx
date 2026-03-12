import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export default function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-5 pb-7.5">
      <div className="flex flex-col justify-center gap-2">
        <h1 className="text-xl font-medium leading-none text-foreground">{title}</h1>
        {subtitle && (
          <div className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      {action && <div className="flex items-center gap-2.5">{action}</div>}
    </div>
  );
}

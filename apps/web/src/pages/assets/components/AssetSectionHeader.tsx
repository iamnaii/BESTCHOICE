// Shared section header for AssetEntryPage — numbered circle + title + optional badge/action.

import type { ReactNode } from 'react';
import { CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  number: number;
  title: string;
  badge?: ReactNode;
  action?: ReactNode;
}

export function AssetSectionHeader({ number, title, badge, action }: Props) {
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
      <div className="flex flex-wrap items-center gap-3 min-w-0">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-bold">
          {number}
        </div>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        {badge}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </CardHeader>
  );
}

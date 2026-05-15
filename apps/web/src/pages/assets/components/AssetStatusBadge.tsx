// Asset module — status chip (uses shared assetStatusMap for labels,
// overrides classes per PDF spec page 8: POSTED green · DISPOSED purple ·
// WRITE-OFF red · FULLY DEPR เทา).

import { Badge } from '@/components/ui/badge';
import { assetStatusMap, getStatusBadgeProps } from '@/lib/status-badges';
import type { AssetStatus } from '../types';

// PDF page 8 color spec — per-status Tailwind override.
// Falls back to the shared map's variant/appearance when unset.
const STATUS_CLASS_OVERRIDE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  POSTED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REVERSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  DISPOSED: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  WRITTEN_OFF: 'bg-red-500/15 text-red-700 dark:text-red-400',
  FULLY_DEPRECIATED: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400',
};

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const cfg = getStatusBadgeProps(status, assetStatusMap);
  const override = STATUS_CLASS_OVERRIDE[status];
  return (
    <Badge
      variant={cfg.variant}
      appearance={cfg.appearance}
      className={override}
    >
      {cfg.label}
    </Badge>
  );
}

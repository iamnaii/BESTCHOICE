// Asset module — status chip (uses shared assetStatusMap)

import { Badge } from '@/components/ui/badge';
import { assetStatusMap, getStatusBadgeProps } from '@/lib/status-badges';
import type { AssetStatus } from '../types';

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const cfg = getStatusBadgeProps(status, assetStatusMap);
  return (
    <Badge variant={cfg.variant} appearance={cfg.appearance}>
      {cfg.label}
    </Badge>
  );
}

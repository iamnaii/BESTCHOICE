import { Crown, Check, User, AlertTriangle, XCircle } from 'lucide-react';
import type { CustomerTier } from '@/types/customer-tier';
import { TIER_LABELS } from '@/types/customer-tier';

interface Props {
  tier: CustomerTier;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
}

const TIER_STYLES: Record<CustomerTier, string> = {
  GOLD: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  GOOD: 'bg-success/10 text-success border-success/30',
  NEW: 'bg-muted text-muted-foreground border-border',
  RISKY: 'bg-warning/10 text-warning border-warning/30',
  BLACKLIST: 'bg-destructive/10 text-destructive border-destructive/30',
};

const TIER_ICONS: Record<CustomerTier, typeof Crown> = {
  GOLD: Crown,
  GOOD: Check,
  NEW: User,
  RISKY: AlertTriangle,
  BLACKLIST: XCircle,
};

export default function CustomerTierBadge({
  tier,
  size = 'sm',
  showIcon = true,
  className = '',
}: Props) {
  const Icon = TIER_ICONS[tier];
  const sizeCls = size === 'sm' ? 'text-2xs px-2 py-0.5' : 'text-xs px-2.5 py-1';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${TIER_STYLES[tier]} ${sizeCls} ${className}`}
      title={TIER_LABELS[tier]}
    >
      {showIcon && <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} />}
      {TIER_LABELS[tier]}
    </span>
  );
}

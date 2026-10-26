import { useState } from 'react';
import { ShieldAlert, ShieldBan } from 'lucide-react';
import type { CustomerBlacklistResult } from '@installment/shared';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import BlacklistReasonList from './BlacklistReasonList';

export const BLACKLIST_BADGE_LABEL = {
  HARD: 'ติด blacklist · ห้ามทำสัญญา',
  SOFT: 'ต้องให้ผู้จัดการอนุมัติ',
} as const;

interface Props {
  result: CustomerBlacklistResult | null | undefined;
  size?: 'sm' | 'md';
  /** กดเพื่อกาง/พับรายการเหตุผล (ค่าเริ่มต้น) · false = ป้ายเฉย ๆ สำหรับที่แคบ */
  expandable?: boolean;
  className?: string;
}

/** ป้าย blacklist (ก้อน 5 C3) — HARD แดง / SOFT เหลือง / NONE ไม่แสดง · เหตุผลชุดเดียวกับหน้าสร้างสัญญา */
export default function CustomerBlacklistBadge({ result, size = 'sm', expandable = true, className }: Props) {
  const [open, setOpen] = useState(false);
  if (!result || result.level === 'NONE') return null;
  const hard = result.level === 'HARD';
  const Icon = hard ? ShieldBan : ShieldAlert;
  const label = BLACKLIST_BADGE_LABEL[result.level];
  const variant = hard ? 'destructive' : 'warning';

  if (!expandable) {
    return (
      <Badge variant={variant} appearance="light" size={size} className={className} title={label}>
        <Icon aria-hidden /> {label}
      </Badge>
    );
  }
  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(badgeVariants({ variant, appearance: 'light', size }), 'cursor-pointer')}
        title={open ? 'พับเหตุผล' : 'ดูเหตุผล'}
      >
        <Icon aria-hidden /> {label}
      </button>
      {open && <BlacklistReasonList reasons={result.reasons} className="mt-1.5" />}
    </div>
  );
}

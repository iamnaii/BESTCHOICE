import {
  Crown,
  AlertTriangle,
  Sparkles,
  Heart,
  Ban,
  Tag,
} from 'lucide-react';
import type { CustomerTagType } from '../hooks/useCustomerTags';

/**
 * Read-only chip row for the 5 customer tag types. Keeps semantic tokens
 * (`bg-success`, `bg-warning`, `bg-destructive`, `bg-info`, `bg-muted`) so
 * the palette flexes with the active theme rather than freezing emerald/red.
 *
 * Used by ContractCard (inline list of indicator chips) and Customer360Panel
 * (header strip). Manual add/remove happens in CustomerTagDialog.
 */
type ChipMeta = {
  label: string;
  icon: typeof Crown;
  /**
   * Tailwind class string. Token-only — no hardcoded hex / `*-500` colour
   * literals (per `.claude/rules/frontend.md`).
   */
  className: string;
};

const META: Record<CustomerTagType, ChipMeta> = {
  VIP: {
    label: 'VIP',
    icon: Crown,
    className: 'bg-success/10 text-success border-success/30',
  },
  HIGH_RISK: {
    label: 'เสี่ยงสูง',
    icon: AlertTriangle,
    className: 'bg-warning/10 text-warning border-warning/30',
  },
  NEW: {
    label: 'ลูกค้าใหม่',
    icon: Sparkles,
    className: 'bg-info/10 text-info border-info/30',
  },
  LOYAL: {
    label: 'ลูกค้าประจำ',
    icon: Heart,
    className: 'bg-primary/10 text-primary border-primary/30',
  },
  BLACKLIST: {
    label: 'BLACKLIST',
    icon: Ban,
    className: 'bg-destructive/10 text-destructive border-destructive/30',
  },
};

interface Props {
  tags: { tag: CustomerTagType }[] | null | undefined;
  /** Optional override label when no tags exist (defaults: hide). */
  emptyLabel?: string;
  /** Compact mode for inline use (smaller font, no border). */
  compact?: boolean;
}

export default function CustomerTagChips({ tags, emptyLabel, compact }: Props) {
  if (!tags || tags.length === 0) {
    if (!emptyLabel) return null;
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground leading-snug">
        <Tag className="size-3" />
        {emptyLabel}
      </span>
    );
  }

  const sizeClasses = compact
    ? 'text-2xs px-1.5 py-0.5 gap-0.5'
    : 'text-2xs px-2 py-0.5 gap-1';
  const iconClasses = 'size-3';

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="customer-tag-chips">
      {tags.map(({ tag }) => {
        const meta = META[tag];
        const Icon = meta.icon;
        return (
          <span
            key={tag}
            className={`inline-flex items-center rounded-full border font-medium leading-snug ${meta.className} ${sizeClasses}`}
            title={meta.label}
            data-testid={`customer-tag-chip-${tag}`}
          >
            <Icon className={iconClasses} aria-hidden="true" />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

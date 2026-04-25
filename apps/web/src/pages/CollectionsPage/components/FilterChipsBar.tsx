import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { QueueFilterState } from '../hooks/useQueueFilter';

interface FilterChipsBarProps {
  filter: QueueFilterState;
  setFilter: (patch: Partial<QueueFilterState>) => void;
  reset: () => void;
  onOpenFilter: () => void;
  resultCount?: number;
  totalCount?: number;
}

interface Chip {
  key: string;
  label: string;
  clear: Partial<QueueFilterState>;
}

function buildChips(f: QueueFilterState): Chip[] {
  const chips: Chip[] = [];

  if (f.assigned === 'self') {
    chips.push({ key: 'assigned-self', label: 'ของฉัน', clear: { assigned: undefined } });
  } else if (f.assigned === 'unassigned') {
    chips.push({
      key: 'assigned-unassigned',
      label: 'ยังไม่ assign',
      clear: { assigned: undefined },
    });
  }

  f.overdueBuckets?.forEach((b) =>
    chips.push({
      key: `bucket-${b}`,
      label: `เลย ${b} วัน`,
      clear: { overdueBuckets: f.overdueBuckets!.filter((x) => x !== b) },
    }),
  );

  if (f.minOutstanding !== undefined || f.maxOutstanding !== undefined) {
    chips.push({
      key: 'outstanding-range',
      label: `ยอด ${(f.minOutstanding ?? 0).toLocaleString()}–${
        f.maxOutstanding !== undefined ? f.maxOutstanding.toLocaleString() : '∞'
      }`,
      clear: { minOutstanding: undefined, maxOutstanding: undefined },
    });
  }

  f.contractStatuses?.forEach((s) =>
    chips.push({
      key: `status-${s}`,
      label: s,
      clear: { contractStatuses: f.contractStatuses!.filter((x) => x !== s) },
    }),
  );

  f.productTypes?.forEach((p) =>
    chips.push({
      key: `product-${p}`,
      label: p,
      clear: { productTypes: f.productTypes!.filter((x) => x !== p) },
    }),
  );

  if (f.minLetterCount !== undefined) {
    chips.push({
      key: 'min-letter',
      label: `จดหมาย ≥${f.minLetterCount}`,
      clear: { minLetterCount: undefined },
    });
  }

  if (f.lastContacted === 'today')
    chips.push({ key: 'lc-today', label: 'ติดต่อวันนี้', clear: { lastContacted: undefined } });
  if (f.lastContacted === 'this_week')
    chips.push({
      key: 'lc-week',
      label: 'ติดต่อสัปดาห์นี้',
      clear: { lastContacted: undefined },
    });
  if (f.lastContacted === 'never')
    chips.push({ key: 'lc-never', label: 'ไม่เคยแตะ', clear: { lastContacted: undefined } });
  if (f.lastContacted === 'over_7_days')
    chips.push({
      key: 'lc-over7',
      label: 'ไม่แตะ >7 วัน',
      clear: { lastContacted: undefined },
    });

  if (f.lineResponse === 'no_line')
    chips.push({ key: 'lr-none', label: 'ไม่มี LINE', clear: { lineResponse: undefined } });

  if (f.minBrokenPromise !== undefined) {
    chips.push({
      key: 'min-broken',
      label: `นัดผิด ≥${f.minBrokenPromise}`,
      clear: { minBrokenPromise: undefined },
    });
  }

  if (f.hasActivePromise === true)
    chips.push({
      key: 'has-promise',
      label: 'มีนัดชำระ',
      clear: { hasActivePromise: undefined },
    });
  if (f.hasActivePromise === false)
    chips.push({
      key: 'no-promise',
      label: 'ไม่มีนัดชำระ',
      clear: { hasActivePromise: undefined },
    });

  if (f.mdmState === 'locked')
    chips.push({ key: 'mdm-locked', label: 'MDM ล็อค', clear: { mdmState: undefined } });
  if (f.mdmState === 'pending')
    chips.push({
      key: 'mdm-pending',
      label: 'MDM รออนุมัติ',
      clear: { mdmState: undefined },
    });
  if (f.mdmState === 'not_locked')
    chips.push({
      key: 'mdm-not-locked',
      label: 'MDM ยังไม่ล็อค',
      clear: { mdmState: undefined },
    });

  if (f.showSkipTracing)
    chips.push({
      key: 'skip-tracing',
      label: 'ต้องหาเบอร์ใหม่',
      clear: { showSkipTracing: false },
    });

  if (f.slipReviewPending)
    chips.push({
      key: 'slip-review',
      label: 'รอยืนยันสลิป',
      clear: { slipReviewPending: false },
    });

  return chips;
}

export default function FilterChipsBar({
  filter,
  setFilter,
  reset,
  onOpenFilter,
  resultCount,
  totalCount,
}: FilterChipsBarProps) {
  const chips = buildChips(filter);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={onOpenFilter} className="gap-1.5">
        <Filter className="size-3.5" />
        ตัวกรอง
        {chips.length > 0 && <span className="ml-0.5 text-primary">({chips.length})</span>}
      </Button>

      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => setFilter(chip.clear)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-2xs leading-snug hover:bg-accent transition-colors"
          aria-label={`ลบตัวกรอง ${chip.label}`}
        >
          {chip.label}
          <X className="size-3" />
        </button>
      ))}

      {chips.length > 0 && (
        <Button variant="ghost" size="sm" onClick={reset} className="text-2xs">
          ล้างทั้งหมด
        </Button>
      )}

      {resultCount !== undefined && totalCount !== undefined && totalCount > resultCount && (
        <span className="ml-auto text-2xs text-muted-foreground leading-snug">
          แสดง {resultCount.toLocaleString()} จาก {totalCount.toLocaleString()}
        </span>
      )}
    </div>
  );
}

import { cn } from '@/lib/utils';
import { Globe } from 'lucide-react';
import { ALL_CHANNELS, CHANNEL_LABELS, type Channel } from './types';

export type ChannelTabValue = Channel | 'ALL';

interface Props {
  value: ChannelTabValue;
  onChange: (next: ChannelTabValue) => void;
  /** Optional badge counts per channel (e.g. number of bubbles targeting that channel) */
  counts?: Partial<Record<ChannelTabValue, number>>;
}

export default function ChannelTabs({ value, onChange, counts = {} }: Props) {
  const tabs: ChannelTabValue[] = ['ALL', ...ALL_CHANNELS];
  const allCount = counts['ALL'];
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
      {tabs.map((t) => {
        const active = value === t;
        const label = t === 'ALL' ? 'ทุก channel' : CHANNEL_LABELS[t];
        const count = counts[t];
        // Show the badge only when it conveys information:
        // - ALL tab: show its total count if > 0
        // - Per-channel tab: only show when count differs from ALL count.
        //   When all bubbles are universal (channels=[]), every per-channel
        //   count equals ALL count, so suppressing the badge avoids spamming
        //   the same number across every tab.
        const shouldShowBadge =
          typeof count === 'number' &&
          count > 0 &&
          (t === 'ALL' ? true : count !== allCount);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors leading-snug',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
            aria-pressed={active}
          >
            {t === 'ALL' && <Globe className="w-3.5 h-3.5" />}
            <span>{label}</span>
            {shouldShowBadge && (
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full',
                  active ? 'bg-primary-foreground/20' : 'bg-background',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

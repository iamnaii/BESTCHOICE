import { cn } from '@/lib/utils';
import { ALL_CHANNELS, CHANNEL_LABELS, type Channel } from './types';

interface Props {
  selectedChannels: string[]; // empty = all
  onChange: (channels: string[]) => void;
}

export default function ChannelChips({ selectedChannels, onChange }: Props) {
  const isAll = selectedChannels.length === 0;
  const toggle = (c: Channel) => {
    if (isAll) {
      // "all" → start excluding by selecting only the OTHERS
      onChange(ALL_CHANNELS.filter((x) => x !== c));
    } else if (selectedChannels.includes(c)) {
      const next = selectedChannels.filter((x) => x !== c);
      // If all 6 → collapse back to []
      onChange(next.length === 0 ? [] : next);
    } else {
      const next = [...selectedChannels, c];
      // If contains all → collapse to []
      onChange(next.length === ALL_CHANNELS.length ? [] : next);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-muted-foreground">Channel:</span>
      <button
        onClick={() => onChange([])}
        className={cn(
          'text-[11px] px-2 py-0.5 rounded border',
          isAll ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:bg-muted',
        )}
      >
        ทุก channel
      </button>
      {ALL_CHANNELS.map((c) => {
        const active = !isAll && selectedChannels.includes(c);
        return (
          <button
            key={c}
            onClick={() => toggle(c)}
            className={cn(
              'text-[11px] px-2 py-0.5 rounded border',
              active ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-background text-muted-foreground border-border hover:bg-muted',
            )}
          >
            {CHANNEL_LABELS[c]}
          </button>
        );
      })}
    </div>
  );
}

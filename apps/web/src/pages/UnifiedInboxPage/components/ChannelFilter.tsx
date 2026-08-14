import { cn } from '@/lib/utils';
import { Inbox, User, Mail } from 'lucide-react';

const TABS = [
  { key: 'mine', label: 'ของฉัน', icon: User },
  { key: 'all', label: 'ทั้งหมด', icon: Inbox },
  { key: 'unread', label: 'ยังไม่อ่าน', icon: Mail },
] as const;

const CHANNELS = [
  { key: 'LINE_FINANCE', label: 'LINE การเงิน', dot: 'bg-[#06C755]' },
  { key: 'LINE_SHOP', label: 'LINE ร้าน', dot: 'bg-[#06C755]' },
  { key: 'FACEBOOK', label: 'Facebook', dot: 'bg-[#1877F2]' },
  { key: 'TIKTOK', label: 'TikTok', dot: 'bg-foreground' },
  { key: 'WEB', label: 'เว็บ', dot: 'bg-muted-foreground' },
] as const;

export type InboxTab = 'mine' | 'all' | 'unread';
export type AiFilter = 'all' | 'ai' | 'human' | 'pending';

const AI_FILTER_LABELS: Record<AiFilter, string> = {
  all: 'ทั้งหมด',
  ai: 'AI',
  human: 'พนักงาน',
  pending: 'รอตอบ',
};

interface ChannelFilterProps {
  activeTab: InboxTab;
  selectedChannels: string[];
  onTabChange: (tab: InboxTab) => void;
  onChannelToggle: (channel: string) => void;
  counts?: { mine: number; all: number; unread: number };
  channelCounts?: Record<string, number>;
  aiFilter?: AiFilter;
  onAiFilterChange?: (filter: AiFilter) => void;
}

export default function ChannelFilter({
  activeTab,
  selectedChannels,
  onTabChange,
  onChannelToggle,
  counts,
  channelCounts,
  aiFilter,
  onAiFilterChange,
}: ChannelFilterProps) {
  return (
    <div>
      {/* Main tabs */}
      <div className="flex px-4 pt-1 gap-0.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              aria-pressed={isActive}
              className={cn(
                'flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
              {counts && counts[tab.key] > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none">
                  {counts[tab.key] > 99 ? '99+' : counts[tab.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Channel + AI status chips — one wrapping row so nothing gets clipped */}
      <div className="flex flex-wrap items-center gap-1 px-3 pb-2.5">
        {CHANNELS.map((ch) => {
          const isActive = selectedChannels.includes(ch.key);
          return (
            <button
              key={ch.key}
              onClick={() => onChannelToggle(ch.key)}
              aria-pressed={isActive}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 min-h-6 text-[11px] rounded-full font-medium transition-all duration-200 whitespace-nowrap',
                isActive
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full transition-colors',
                isActive ? 'bg-background/60' : ch.dot,
              )} />
              {ch.label}
              {channelCounts && channelCounts[ch.key] > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none">
                  {channelCounts[ch.key] > 99 ? '99+' : channelCounts[ch.key]}
                </span>
              )}
            </button>
          );
        })}

        {aiFilter && onAiFilterChange && (
          <>
            <span className="mx-1 h-3.5 w-px bg-border/60" aria-hidden />
            {(Object.keys(AI_FILTER_LABELS) as AiFilter[]).map((key) => (
              <button
                key={key}
                onClick={() => onAiFilterChange(key)}
                aria-pressed={aiFilter === key}
                className={cn(
                  'px-2 py-1 min-h-6 text-[11px] rounded-full border font-medium transition-colors whitespace-nowrap',
                  aiFilter === key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border/60 hover:bg-muted',
                )}
              >
                {AI_FILTER_LABELS[key]}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

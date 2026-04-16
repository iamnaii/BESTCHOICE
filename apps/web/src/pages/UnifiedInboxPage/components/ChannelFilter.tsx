import { cn } from '@/lib/utils';

const TABS = [
  { key: 'mine', label: 'ของฉัน' },
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'unread', label: 'ยังไม่อ่าน' },
] as const;

const CHANNELS = [
  { key: 'LINE_FINANCE', label: 'LINE การเงิน', dot: 'bg-[#06C755]' },
  { key: 'LINE_SHOP', label: 'LINE ร้าน', dot: 'bg-[#06C755]' },
  { key: 'FACEBOOK', label: 'Facebook', dot: 'bg-[#1877F2]' },
  { key: 'TIKTOK', label: 'TikTok', dot: 'bg-foreground' },
  { key: 'WEB', label: 'เว็บ', dot: 'bg-muted-foreground' },
] as const;

export type InboxTab = 'mine' | 'all' | 'unread';

interface ChannelFilterProps {
  activeTab: InboxTab;
  selectedChannels: string[];
  onTabChange: (tab: InboxTab) => void;
  onChannelToggle: (channel: string) => void;
}

export default function ChannelFilter({
  activeTab,
  selectedChannels,
  onTabChange,
  onChannelToggle,
}: ChannelFilterProps) {
  return (
    <div className="border-b border-border">
      {/* Main tabs */}
      <div className="flex">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors relative',
              activeTab === tab.key
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Channel filter chips */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
        {CHANNELS.map((ch) => {
          const isActive = selectedChannels.includes(ch.key);
          return (
            <button
              key={ch.key}
              onClick={() => onChannelToggle(ch.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-primary-foreground/70' : ch.dot)} />
              {ch.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

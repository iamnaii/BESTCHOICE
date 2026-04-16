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
    <div>
      {/* Main tabs — pill style */}
      <div className="flex gap-1 px-3 py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-md transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/70',
              )}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Channel filter chips */}
      <div className="flex gap-1 px-3 pb-2.5 overflow-x-auto">
        {CHANNELS.map((ch) => {
          const isActive = selectedChannels.includes(ch.key);
          return (
            <button
              key={ch.key}
              onClick={() => onChannelToggle(ch.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] rounded-full font-medium transition-all duration-200 whitespace-nowrap',
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

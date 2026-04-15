import { cn } from '@/lib/utils';

const TABS = [
  { key: 'mine', label: 'ของฉัน' },
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'unread', label: 'ยังไม่อ่าน' },
] as const;

const CHANNELS = [
  { key: 'LINE_FINANCE', label: 'LINE การเงิน' },
  { key: 'LINE_SHOP', label: 'LINE ร้าน' },
  { key: 'FACEBOOK', label: 'Facebook' },
  { key: 'TIKTOK', label: 'TikTok' },
  { key: 'WEB', label: 'เว็บ' },
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
    <div className="border-b border-gray-200">
      {/* Main tabs: mine / all / unread */}
      <div className="flex border-b border-gray-100">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'text-blue-600 border-b-2 border-blue-500 -mb-px'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Channel filter chips (multi-select) */}
      <div className="flex overflow-x-auto px-2 py-2 gap-1">
        {CHANNELS.map((ch) => {
          const isActive = selectedChannels.includes(ch.key);
          return (
            <button
              key={ch.key}
              onClick={() => onChannelToggle(ch.key)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {ch.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { cn } from '@/lib/utils';

const CHANNELS = [
  { key: undefined, label: 'ทั้งหมด' },
  { key: 'LINE_FINANCE', label: 'LINE การเงิน' },
  { key: 'LINE_SHOP', label: 'LINE ร้าน' },
  { key: 'FACEBOOK', label: 'Facebook' },
  { key: 'TIKTOK', label: 'TikTok' },
  { key: 'WEB', label: 'เว็บ' },
] as const;

const STATUSES = [
  { key: undefined, label: 'ทุกสถานะ' },
  { key: 'OPEN', label: 'เปิด' },
  { key: 'HANDOFF', label: 'รอพนักงาน' },
  { key: 'PENDING', label: 'กำลังดูแล' },
  { key: 'RESOLVED', label: 'เสร็จ' },
] as const;

interface ChannelFilterProps {
  activeChannel?: string;
  activeStatus?: string;
  onChannelChange: (channel?: string) => void;
  onStatusChange: (status?: string) => void;
}

export default function ChannelFilter({
  activeChannel,
  activeStatus,
  onChannelChange,
  onStatusChange,
}: ChannelFilterProps) {
  return (
    <div className="border-b border-gray-200">
      {/* Channel tabs */}
      <div className="flex overflow-x-auto px-2 pt-2 gap-1">
        {CHANNELS.map((ch) => (
          <button
            key={ch.key ?? 'all'}
            onClick={() => onChannelChange(ch.key)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-colors',
              activeChannel === ch.key
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {ch.label}
          </button>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex overflow-x-auto px-2 py-2 gap-1">
        {STATUSES.map((st) => (
          <button
            key={st.key ?? 'all'}
            onClick={() => onStatusChange(st.key)}
            className={cn(
              'px-2.5 py-1 text-[11px] rounded-full whitespace-nowrap transition-colors',
              activeStatus === st.key
                ? 'bg-gray-700 text-white'
                : 'bg-gray-50 text-gray-500 hover:bg-gray-100',
            )}
          >
            {st.label}
          </button>
        ))}
      </div>
    </div>
  );
}

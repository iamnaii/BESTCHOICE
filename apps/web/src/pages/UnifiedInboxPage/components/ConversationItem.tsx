import { MessageSquare, Phone, Globe, Video, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, sessionPriorityMap } from '@/lib/status-badges';

interface ConversationItemProps {
  session: {
    id: string;
    channel: string;
    priority: string;
    leadTemperature?: string | null;
    leadScore?: number | null;
    pinnedAt?: string | null;
    unreadCount?: number;
    customer?: { id: string; name: string; phone?: string } | null;
    assignedTo?: { id: string; name: string; avatarUrl?: string | null } | null;
    tags?: { tag: string }[];
    messages?: { text?: string | null; role: string; createdAt: string }[];
    lastMessageAt: string;
    totalMessages: number;
    lineUserId?: string;
  };
  isActive: boolean;
  onClick: () => void;
}

const CHANNEL_ICONS: Record<string, typeof MessageSquare> = {
  LINE_FINANCE: Phone,
  LINE_SHOP: MessageSquare,
  FACEBOOK: Globe,
  TIKTOK: Video,
  WEB: Globe,
};

const CHANNEL_COLORS: Record<string, string> = {
  LINE_FINANCE: 'bg-green-500',
  LINE_SHOP: 'bg-emerald-400',
  FACEBOOK: 'bg-blue-600',
  TIKTOK: 'bg-pink-500',
  WEB: 'bg-gray-500',
};

export default function ConversationItem({ session, isActive, onClick }: ConversationItemProps) {
  const ChannelIcon = CHANNEL_ICONS[session.channel] ?? MessageSquare;
  const lastMessage = session.messages?.[0];
  const displayName = session.customer?.name ?? session.lineUserId?.slice(0, 12) ?? 'ไม่ทราบชื่อ';
  const isPinned = session.pinnedAt != null;
  const unreadCount = session.unreadCount ?? 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100',
        isActive && 'bg-blue-50 hover:bg-blue-50 border-l-2 border-l-blue-500',
        isPinned && !isActive && 'bg-amber-50/50',
      )}
    >
      {/* Channel avatar */}
      <div className="relative flex-shrink-0 mt-0.5">
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center text-white',
            CHANNEL_COLORS[session.channel] ?? 'bg-gray-500',
          )}
        >
          <ChannelIcon className="w-5 h-5" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Pin icon */}
            {isPinned && <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />}
            <span className="font-medium text-sm text-gray-900 truncate">{displayName}</span>
            {session.leadTemperature === 'HOT' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-600 flex-shrink-0">
                🔥 HOT
              </span>
            )}
            {session.leadTemperature === 'WARM' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-600 flex-shrink-0">
                WARM
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Unread badge */}
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            <span className="text-xs text-gray-400">
              {formatDistanceToNow(new Date(session.lastMessageAt), { addSuffix: true, locale: th })}
            </span>
          </div>
        </div>

        {/* Last message preview */}
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {lastMessage?.role === 'STAFF' && <span className="text-blue-500">คุณ: </span>}
          {lastMessage?.role === 'BOT' && <span className="text-purple-500">Bot: </span>}
          {lastMessage?.text ?? '(ข้อความสื่อ)'}
        </p>

        {/* Tags + priority + assigned */}
        <div className="flex items-center gap-1 mt-1">
          {session.tags?.some((t: any) => t.tag === 'overdue') && (
            <Badge variant="destructive" appearance="light" className="text-[10px] px-1.5 py-0.5">
              ค้างชำระ
            </Badge>
          )}
          {session.priority && session.priority !== 'NORMAL' && session.priority !== 'LOW' && (
            (() => {
              const cfg = getStatusBadgeProps(session.priority, sessionPriorityMap);
              return (
                <Badge variant={cfg.variant} appearance={cfg.appearance} className="text-[10px] px-1.5 py-0.5">
                  {cfg.label}
                </Badge>
              );
            })()
          )}
          {session.tags?.slice(0, 3).map((t) => (
            <span key={t.tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {t.tag}
            </span>
          ))}
          {session.assignedTo && (
            <span className="text-[10px] text-gray-400 ml-auto">{session.assignedTo.name}</span>
          )}
        </div>
      </div>
    </button>
  );
}

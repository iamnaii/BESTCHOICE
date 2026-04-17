import { Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, sessionPriorityMap } from '@/lib/status-badges';
import { useState } from 'react';

interface ConversationItemProps {
  session: {
    id: string;
    channel: string;
    priority: string;
    leadTemperature?: string | null;
    leadScore?: number | null;
    pinnedAt?: string | null;
    unreadCount?: number;
    customer?: { id: string; name: string; phone?: string; avatarUrl?: string | null; lineAvatarUrl?: string | null } | null;
    assignedTo?: { id: string; name: string; avatarUrl?: string | null } | null;
    tags?: { tag: string }[];
    messages?: { text?: string | null; role: string; createdAt: string }[];
    lastMessageAt: string;
    totalMessages: number;
    lineUserId?: string;
  };
  isActive: boolean;
  onClick: () => void;
  onPin?: (roomId: string, isPinned: boolean) => void;
}

const CHANNEL_CONFIG: Record<string, { bg: string; label: string; text: string }> = {
  LINE_FINANCE: { bg: 'bg-[#06C755]', label: 'L', text: 'LINE' },
  LINE_SHOP: { bg: 'bg-[#06C755]', label: 'L', text: 'LINE' },
  FACEBOOK: { bg: 'bg-[#1877F2]', label: 'f', text: 'FB' },
  TIKTOK: { bg: 'bg-foreground', label: '♪', text: 'TT' },
  WEB: { bg: 'bg-muted-foreground', label: 'W', text: 'Web' },
};

function Avatar({ session, displayName }: { session: ConversationItemProps['session']; displayName: string }) {
  const [imgError, setImgError] = useState(false);
  const avatarUrl = session.customer?.avatarUrl || session.customer?.lineAvatarUrl;
  const channelCfg = CHANNEL_CONFIG[session.channel] ?? { bg: 'bg-muted-foreground', label: '?' };

  return (
    <div className="relative flex-shrink-0">
      {avatarUrl && !imgError ? (
        <img
          src={avatarUrl}
          alt={session.customer?.name ?? ''}
          className="w-10 h-10 rounded-full object-cover ring-2 ring-background"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold ring-2 ring-background',
            channelCfg.bg,
          )}
        >
          {displayName[0]}
        </div>
      )}
      {/* Channel dot */}
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-[2px] border-card',
          'flex items-center justify-center text-white text-[7px] font-extrabold',
          channelCfg.bg,
        )}
      >
        {channelCfg.label}
      </span>
    </div>
  );
}

export default function ConversationItem({ session, isActive, onClick, onPin }: ConversationItemProps) {
  const lastMessage = session.messages?.[0];
  const displayName = session.customer?.name ?? session.lineUserId?.slice(0, 12) ?? 'ไม่ทราบชื่อ';
  const isPinned = session.pinnedAt != null;
  const unreadCount = session.unreadCount ?? 0;
  const hasUnread = unreadCount > 0;

  return (
    <div
      className={cn(
        'relative group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors duration-100 border-b border-border/40',
        isActive
          ? 'bg-primary/5 border-l-2 border-l-primary'
          : 'hover:bg-muted/40',
        isPinned && !isActive && 'bg-amber-50/20',
      )}
      onClick={onClick}
    >
      <Avatar session={session} displayName={displayName} />

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {isPinned && <Pin className="w-2.5 h-2.5 text-amber-500 flex-shrink-0 fill-amber-500" />}
            <span className={cn(
              'text-[13px] truncate',
              hasUnread ? 'font-bold text-foreground' : 'font-medium text-foreground/80',
            )}>
              {displayName}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 tabular-nums">
            {formatDistanceToNow(new Date(session.lastMessageAt), { addSuffix: false, locale: th })}
          </span>
        </div>

        {/* Last message preview */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={cn(
            'text-xs truncate',
            hasUnread ? 'text-foreground/70' : 'text-muted-foreground/70',
          )}>
            {lastMessage?.role === 'STAFF' && <span className="text-primary font-medium">คุณ: </span>}
            {lastMessage?.role === 'BOT' && <span className="text-purple-500 font-medium">Bot: </span>}
            {lastMessage?.text ?? '(ข้อความสื่อ)'}
          </p>
          {hasUnread && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none flex-shrink-0">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>

        {/* Tags + priority + assigned */}
        {(session.tags?.length || (session.priority && session.priority !== 'NORMAL' && session.priority !== 'LOW') || session.assignedTo) && (
          <div className="flex items-center gap-1 mt-1.5">
            {session.tags?.some((t: { tag: string }) => t.tag === 'overdue') && (
              <Badge variant="destructive" appearance="light" className="text-[9px] px-1.5 py-0 h-4">
                ค้างชำระ
              </Badge>
            )}
            {session.priority && session.priority !== 'NORMAL' && session.priority !== 'LOW' && (
              (() => {
                const cfg = getStatusBadgeProps(session.priority, sessionPriorityMap);
                return (
                  <Badge variant={cfg.variant} appearance={cfg.appearance} className="text-[9px] px-1.5 py-0 h-4">
                    {cfg.label}
                  </Badge>
                );
              })()
            )}
            {session.assignedTo && (
              <span className="text-[10px] text-muted-foreground/60 ml-auto truncate max-w-[80px]">
                {session.assignedTo.name}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Hover pin button */}
      {onPin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin(session.id, isPinned);
          }}
          className={cn(
            'absolute right-2 top-2 p-1 rounded-md transition-all',
            isPinned
              ? 'text-amber-500 opacity-100'
              : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-amber-500 hover:bg-muted',
          )}
          title={isPinned ? 'ถอดหมุด' : 'ปักหมุด'}
        >
          <Pin className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

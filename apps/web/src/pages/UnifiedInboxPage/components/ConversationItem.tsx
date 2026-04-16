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

const CHANNEL_COLORS: Record<string, string> = {
  LINE_FINANCE: 'bg-[#06C755]',
  LINE_SHOP: 'bg-[#06C755]',
  FACEBOOK: 'bg-[#1877F2]',
  TIKTOK: 'bg-foreground',
  WEB: 'bg-muted-foreground',
};

function ChannelIcon({ channel }: { channel: string }) {
  const config: Record<string, { bg: string; label: string }> = {
    LINE_FINANCE: { bg: 'bg-[#06C755]', label: 'L' },
    LINE_SHOP: { bg: 'bg-[#06C755]', label: 'L' },
    FACEBOOK: { bg: 'bg-[#1877F2]', label: 'f' },
    TIKTOK: { bg: 'bg-foreground', label: '♪' },
    WEB: { bg: 'bg-muted-foreground', label: 'W' },
  };
  const c = config[channel] ?? { bg: 'bg-muted-foreground', label: '?' };
  return (
    <span
      className={cn(
        'absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background',
        'flex items-center justify-center text-white text-[8px] font-bold',
        c.bg,
      )}
    >
      {c.label}
    </span>
  );
}

function Avatar({ session, displayName }: { session: ConversationItemProps['session']; displayName: string }) {
  const [imgError, setImgError] = useState(false);
  const avatarUrl = session.customer?.avatarUrl || session.customer?.lineAvatarUrl;

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={session.customer?.name ?? ''}
        className="w-10 h-10 rounded-full object-cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        'w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold',
        CHANNEL_COLORS[session.channel] ?? 'bg-muted-foreground',
      )}
    >
      {displayName[0]}
    </div>
  );
}

export default function ConversationItem({ session, isActive, onClick, onPin }: ConversationItemProps) {
  const lastMessage = session.messages?.[0];
  const displayName = session.customer?.name ?? session.lineUserId?.slice(0, 12) ?? 'ไม่ทราบชื่อ';
  const isPinned = session.pinnedAt != null;
  const unreadCount = session.unreadCount ?? 0;

  return (
    <div
      className={cn(
        'relative group w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border cursor-pointer',
        isActive
          ? 'bg-primary/5 hover:bg-primary/5 border-l-2 border-l-primary'
          : 'hover:bg-accent',
        isPinned && !isActive && 'bg-amber-50/50',
      )}
      onClick={onClick}
    >
      {/* Customer avatar with channel badge */}
      <div className="relative flex-shrink-0 mt-0.5">
        <Avatar session={session} displayName={displayName} />
        <ChannelIcon channel={session.channel} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {isPinned && <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />}
            <span className={cn('font-medium text-sm truncate', unreadCount > 0 ? 'text-foreground' : 'text-foreground/80')}>
              {displayName}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">
              {formatDistanceToNow(new Date(session.lastMessageAt), { addSuffix: true, locale: th })}
            </span>
          </div>
        </div>

        {/* Last message preview */}
        <p className={cn('text-xs truncate mt-0.5', unreadCount > 0 ? 'text-foreground/70 font-medium' : 'text-muted-foreground')}>
          {lastMessage?.role === 'STAFF' && <span className="text-primary">คุณ: </span>}
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
            <span key={t.tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {t.tag}
            </span>
          ))}
          {session.assignedTo && (
            <span className="text-[10px] text-muted-foreground ml-auto">{session.assignedTo.name}</span>
          )}
        </div>
      </div>

      {/* Hover pin button */}
      {onPin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin(session.id, isPinned);
          }}
          className={cn(
            'absolute right-2 top-2 p-1 rounded transition-all',
            isPinned
              ? 'text-amber-500 opacity-100'
              : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-amber-500',
          )}
          title={isPinned ? 'ถอดหมุด' : 'ปักหมุด'}
        >
          <Pin className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

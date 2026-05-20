import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { MessageCircle, MessageSquare } from 'lucide-react';
import { computeSlaBreach } from '../hooks/useRooms';
import type { ChatRoomSummary } from '../lib/chat-api';

export interface AiSettingsLite {
  autoModeEnabled: boolean;
  enabledChannels: string[];
}

function AiStatusBadge({
  aiAutoEnabled,
  channel,
  enabledChannels,
  aiPaused,
  handoffMode,
}: {
  aiAutoEnabled: boolean;
  channel: string;
  enabledChannels: string[];
  aiPaused: boolean;
  handoffMode: boolean;
}) {
  if (handoffMode) {
    return (
      <span className="inline-flex items-center gap-1 text-xs leading-snug text-destructive">
        <span className="size-2 rounded-full bg-destructive" />
        ต้องตอบ
      </span>
    );
  }
  if (aiPaused) {
    return (
      <span className="inline-flex items-center gap-1 text-xs leading-snug text-amber-600">
        <span className="size-2 rounded-full bg-amber-500" />
        พนักงาน
      </span>
    );
  }
  const channelAllowed =
    aiAutoEnabled && enabledChannels.length > 0 && enabledChannels.includes(channel);
  if (channelAllowed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs leading-snug text-emerald-600">
        <span className="size-2 rounded-full bg-emerald-500" />
        AI
      </span>
    );
  }
  return null;
}

export function RoomListItem({
  room,
  active,
  onClick,
  aiSettings,
}: {
  room: ChatRoomSummary;
  active: boolean;
  onClick: () => void;
  aiSettings?: AiSettingsLite;
}) {
  const ChannelIcon = room.channel === 'FACEBOOK' ? MessageCircle : MessageSquare;
  const name = room.customer?.name ?? room.displayName ?? 'ไม่ระบุชื่อ';
  const initial = name.trim().charAt(0) || '?';
  const lastMessage = room.messages?.[0]?.text ?? null;
  const slaBreach = computeSlaBreach(room);

  return (
    <button
      type="button"
      data-testid="room-list-item"
      onClick={onClick}
      className={cn(
        'flex w-full gap-3 rounded-md p-3 text-left transition-colors hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      <Avatar className="h-10 w-10 shrink-0">
        {room.pictureUrl && <AvatarImage src={room.pictureUrl} alt={name} />}
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium leading-snug text-foreground">{name}</span>
          <ChannelIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>
        <div className="truncate text-xs leading-snug text-muted-foreground">
          {lastMessage ?? '...'}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {room.unreadCount > 0 && <Badge variant="primary">{room.unreadCount}</Badge>}
          {room.handoffMode && <Badge variant="destructive">Handoff</Badge>}
          {room.aiPaused && <Badge variant="secondary">รับช่วง</Badge>}
          {slaBreach && <Badge variant="destructive">SLA</Badge>}
          <AiStatusBadge
            aiAutoEnabled={aiSettings?.autoModeEnabled ?? false}
            channel={room.channel}
            enabledChannels={aiSettings?.enabledChannels ?? []}
            aiPaused={room.aiPaused}
            handoffMode={room.handoffMode}
          />
        </div>
      </div>
    </button>
  );
}

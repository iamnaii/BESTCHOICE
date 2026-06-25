import { useState, useEffect, useMemo } from 'react';
import { nextRoomIndex } from './list-nav';
import { isEditableTarget } from '../hooks/useKeyboardShortcuts';
import { Search, MessageCircle, X, Bell, BellOff } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import ConversationItem from './ConversationItem';
import ChannelFilter, { type InboxTab } from './ChannelFilter';
import { deriveTabCounts } from './tab-counts';

type AiFilter = 'all' | 'ai' | 'human' | 'pending';

const AI_FILTER_LABELS: Record<AiFilter, string> = {
  all: 'ทั้งหมด',
  ai: 'AI',
  human: 'พนักงาน',
  pending: 'รอตอบ',
};

interface ConversationListProps {
  sessions: any[];
  activeRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  isLoading: boolean;
  filters: {
    tab: InboxTab;
    channels: string[];
    search?: string;
  };
  onFiltersChange: (filters: any) => void;
  currentUserId?: string;
  aiSettings?: { autoModeEnabled: boolean; enabledChannels: string[] };
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  muteAll?: boolean;
  onToggleMuteAll?: () => void;
}

export default function ConversationList({
  sessions,
  activeRoomId,
  onSelectRoom,
  isLoading,
  filters,
  onFiltersChange,
  currentUserId,
  aiSettings,
  connectionStatus,
  muteAll,
  onToggleMuteAll,
}: ConversationListProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const [searchFocused, setSearchFocused] = useState(false);
  const [aiFilter, setAiFilter] = useState<AiFilter>('all');
  const debouncedSearch = useDebounce(searchInput, 300);

  const queryClient = useQueryClient();
  const pinMutation = useMutation({
    mutationFn: ({ roomId, isPinned }: { roomId: string; isPinned: boolean }) =>
      isPinned
        ? api.delete(`/staff-chat/rooms/${roomId}/pin`)
        : api.post(`/staff-chat/rooms/${roomId}/pin`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
  });

  // Update parent filter when debounced search changes
  useEffect(() => {
    const normalizedDebounced = debouncedSearch || undefined;
    if (normalizedDebounced !== filters.search) {
      onFiltersChange({ ...filters, search: normalizedDebounced });
    }
  }, [debouncedSearch]);

  const handleChannelToggle = (channel: string) => {
    const current = filters.channels ?? [];
    const updated = current.includes(channel)
      ? current.filter((c: string) => c !== channel)
      : [...current, channel];
    onFiltersChange({ ...filters, channels: updated });
  };

  const filteredAndSorted = useMemo(() => {
    let list = [...sessions];

    // Tab filter
    if (filters.tab === 'mine') {
      list = list.filter((r) => r.assignedTo?.id === currentUserId);
    } else if (filters.tab === 'unread') {
      list = list.filter((r) => (r.unreadCount ?? 0) > 0);
    }
    // 'all' — no filter

    // Channel filter (multi-select, empty = show all)
    if (filters.channels?.length > 0) {
      list = list.filter((r) => filters.channels.includes(r.channel));
    }

    // AI filter (ChatInboxPage parity)
    // - 'ai'      — AI is replying (not paused, not in handoff)
    // - 'human'   — staff has taken over (aiPaused)
    // - 'pending' — bot escalated to a human (handoffMode)
    if (aiFilter === 'ai') {
      list = list.filter((r) => !r.aiPaused && !r.handoffMode);
    } else if (aiFilter === 'human') {
      list = list.filter((r) => r.aiPaused);
    } else if (aiFilter === 'pending') {
      list = list.filter((r) => r.handoffMode);
    }

    // Search filter
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (r) =>
          r.customer?.name?.toLowerCase().includes(q) ||
          r.customer?.phone?.includes(q) ||
          r.lineUserId?.toLowerCase().includes(q),
      );
    }

    // Sort: pinned first → then by lastMessageAt desc
    list.sort((a, b) => {
      const aPinned = a.pinnedAt != null ? 1 : 0;
      const bPinned = b.pinnedAt != null ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    return list;
  }, [sessions, filters, currentUserId, aiFilter]);

  const tabCounts = useMemo(() => deriveTabCounts(sessions, currentUserId), [sessions, currentUserId]);

  // j/k navigate the visible (filtered+sorted) room list; guarded so it never
  // fires while typing in the composer or search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      const idx = filteredAndSorted.findIndex((r) => r.id === activeRoomId);
      const next = nextRoomIndex(idx, e.key === 'j' ? 1 : -1, filteredAndSorted.length);
      if (next < 0) return;
      const room = filteredAndSorted[next];
      onSelectRoom(room.id);
      document
        .querySelector(`[data-room-id="${room.id}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredAndSorted, activeRoomId, onSelectRoom]);

  return (
    <div className="flex flex-col h-full border-r border-border/60">
      {/* Search + Filters */}
      <div className="px-4 pt-3 pb-0">
        {/* Header row: connection pill (when not connected) + global bell toggle */}
        {(connectionStatus && connectionStatus !== 'connected') || onToggleMuteAll ? (
          <div className="mb-2 flex items-center justify-between gap-2">
            {/* Connection status pill — shown only when not connected */}
            {connectionStatus && connectionStatus !== 'connected' ? (
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium leading-snug',
                  connectionStatus === 'disconnected'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-warning/10 text-warning',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    connectionStatus === 'disconnected' ? 'bg-destructive' : 'bg-warning animate-pulse',
                  )}
                />
                {connectionStatus === 'disconnected'
                  ? 'ออฟไลน์ — ไม่ได้เชื่อมต่อเรียลไทม์'
                  : connectionStatus === 'reconnecting'
                    ? 'กำลังเชื่อมต่อใหม่...'
                    : 'กำลังเชื่อมต่อ...'}
              </div>
            ) : (
              <div />
            )}
            {/* Global mute bell toggle */}
            {onToggleMuteAll && (
              <button
                type="button"
                onClick={onToggleMuteAll}
                title={muteAll ? 'เปิดการแจ้งเตือน' : 'ปิดการแจ้งเตือนทั้งหมด'}
                aria-label={muteAll ? 'เปิดการแจ้งเตือน' : 'ปิดการแจ้งเตือน'}
                className="p-1.5 min-h-11 min-w-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                {muteAll ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              </button>
            )}
          </div>
        ) : null}
        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เบอร์..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md bg-muted/40 border-0 focus:outline-none focus:ring-1 focus:ring-primary/20 focus:bg-background transition-all placeholder:text-muted-foreground/40"
          />
          {searchInput.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                onFiltersChange({ ...filters, search: undefined }); // clear immediately, don't wait for debounce
              }}
              aria-label="ล้างการค้นหา"
              className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground/50 hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs + Channel filter */}
      <ChannelFilter
        activeTab={filters.tab}
        selectedChannels={filters.channels ?? []}
        onTabChange={(tab) => onFiltersChange({ ...filters, tab })}
        onChannelToggle={handleChannelToggle}
        counts={tabCounts}
      />

      {/* AI status filter chips — owner asked "หาแต่แชทที่รอตอบ" → 'pending' */}
      <div className="flex gap-1.5 px-4 pb-2 pt-1">
        {(['all', 'ai', 'human', 'pending'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setAiFilter(key)}
            className={cn(
              'px-2 py-0.5 text-[10px] rounded-full border transition-colors',
              aiFilter === key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border/60 hover:bg-muted',
            )}
          >
            {AI_FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-border/60" />

      {/* Room list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                  <div className="h-2.5 w-36 bg-muted rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
              <MessageCircle className="w-5 h-5 text-muted-foreground/40" />
            </div>
            {sessions.length === 0 ? (
              <>
                <p className="text-xs font-medium text-muted-foreground leading-snug">ยังไม่มีการสนทนา</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-snug">
                  เมื่อมีลูกค้าทักเข้ามา แชทจะแสดงที่นี่
                </p>
              </>
            ) : filters.search ? (
              <>
                <p className="text-xs font-medium text-muted-foreground leading-snug">
                  ไม่พบผลการค้นหา &ldquo;{filters.search}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    onFiltersChange({ ...filters, search: undefined });
                  }}
                  className="text-[10px] text-primary hover:underline mt-1"
                >
                  ล้างการค้นหา
                </button>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-muted-foreground leading-snug">ไม่มีแชทในตัวกรองนี้</p>
                <button
                  type="button"
                  onClick={() => {
                    onFiltersChange({ ...filters, channels: [], tab: 'all' });
                    setAiFilter('all');
                  }}
                  className="text-[10px] text-primary hover:underline mt-1"
                >
                  ดูทั้งหมด
                </button>
              </>
            )}
          </div>
        ) : (
          filteredAndSorted.map((session) => (
            <div key={session.id} data-room-id={session.id}>
              <ConversationItem
                session={session}
                isActive={session.id === activeRoomId}
                onClick={() => onSelectRoom(session.id)}
                onPin={(roomId, isPinned) => pinMutation.mutate({ roomId, isPinned })}
                aiSettings={aiSettings}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

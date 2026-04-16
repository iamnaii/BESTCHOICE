import { useState, useEffect, useMemo } from 'react';
import { Search, MessageCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import ConversationItem from './ConversationItem';
import ChannelFilter, { type InboxTab } from './ChannelFilter';

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
}

export default function ConversationList({
  sessions,
  activeRoomId,
  onSelectRoom,
  isLoading,
  filters,
  onFiltersChange,
  currentUserId,
}: ConversationListProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const [searchFocused, setSearchFocused] = useState(false);
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
  }, [sessions, filters, currentUserId]);

  return (
    <div className="flex flex-col h-full border-r border-border bg-card">
      {/* Header */}
      <div className="px-4 pt-4 pb-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-foreground tracking-tight">แชท</h2>
          <span className="text-[10px] font-semibold text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {sessions.length}
          </span>
        </div>

        {/* Search */}
        <div className={cn(
          'relative rounded-lg transition-all duration-200',
          searchFocused ? 'ring-2 ring-primary/20' : '',
        )}>
          <Search className={cn(
            'absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 transition-colors',
            searchFocused ? 'text-primary' : 'text-muted-foreground/50',
          )} />
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เบอร์..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-muted/40 border-0 focus:outline-none focus:bg-background transition-all duration-200 placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      {/* Tabs + Channel filter */}
      <ChannelFilter
        activeTab={filters.tab}
        selectedChannels={filters.channels ?? []}
        onTabChange={(tab) => onFiltersChange({ ...filters, tab })}
        onChannelToggle={handleChannelToggle}
      />

      {/* Divider */}
      <div className="h-px bg-border" />

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
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
              <MessageCircle className="w-5 h-5 text-muted-foreground/40" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">ไม่พบการสนทนา</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">ลองเปลี่ยนตัวกรองหรือค้นหาใหม่</p>
          </div>
        ) : (
          filteredAndSorted.map((session) => (
            <ConversationItem
              key={session.id}
              session={session}
              isActive={session.id === activeRoomId}
              onClick={() => onSelectRoom(session.id)}
              onPin={(roomId, isPinned) => pinMutation.mutate({ roomId, isPinned })}
            />
          ))
        )}
      </div>
    </div>
  );
}

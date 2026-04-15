import { useState, useEffect, useMemo } from 'react';
import { Search, Filter } from 'lucide-react';
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
    <div className="flex flex-col h-full border-r border-gray-200">
      {/* Search bar */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เบอร์..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Tab + channel filter */}
      <ChannelFilter
        activeTab={filters.tab}
        selectedChannels={filters.channels ?? []}
        onTabChange={(tab) => onFiltersChange({ ...filters, tab })}
        onChannelToggle={handleChannelToggle}
      />

      {/* Room list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
            กำลังโหลด...
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 text-sm">
            <Filter className="w-8 h-8 mb-2" />
            <span>ไม่พบการสนทนา</span>
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

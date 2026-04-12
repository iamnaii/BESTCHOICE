import { useState } from 'react';
import { Search, Filter } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import ConversationItem from './ConversationItem';
import ChannelFilter from './ChannelFilter';

interface ConversationListProps {
  sessions: any[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  isLoading: boolean;
  filters: {
    channel?: string;
    sessionStatus?: string;
    search?: string;
  };
  onFiltersChange: (filters: any) => void;
}

export default function ConversationList({
  sessions,
  activeSessionId,
  onSelectSession,
  isLoading,
  filters,
  onFiltersChange,
}: ConversationListProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);

  // Update parent filter when debounced search changes
  if (debouncedSearch !== filters.search) {
    onFiltersChange({ ...filters, search: debouncedSearch || undefined });
  }

  return (
    <div className="flex flex-col h-full border-r border-gray-200">
      {/* Search */}
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

      {/* Channel tabs */}
      <ChannelFilter
        activeChannel={filters.channel}
        activeStatus={filters.sessionStatus}
        onChannelChange={(channel) => onFiltersChange({ ...filters, channel })}
        onStatusChange={(sessionStatus) => onFiltersChange({ ...filters, sessionStatus })}
      />

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
            กำลังโหลด...
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 text-sm">
            <Filter className="w-8 h-8 mb-2" />
            <span>ไม่พบการสนทนา</span>
          </div>
        ) : (
          sessions.map((session) => (
            <ConversationItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onClick={() => onSelectSession(session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

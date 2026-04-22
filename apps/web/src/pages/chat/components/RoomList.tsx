import { ScrollArea } from '@/components/ui/scroll-area';
import { useDebounce } from '@/hooks/useDebounce';
import { useState } from 'react';
import { useRooms } from '../hooks/useRooms';
import type { ChannelFilter, RoomFilter } from '../lib/chat-api';
import { RoomFilters } from './RoomFilters';
import { RoomListItem } from './RoomListItem';

export function RoomList({
  activeRoomId,
  onSelect,
}: {
  activeRoomId: string | null;
  onSelect: (roomId: string) => void;
}) {
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { data = [], isLoading, isError } = useRooms(filter, channel, debouncedSearch || undefined);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <RoomFilters
        filter={filter}
        onFilterChange={setFilter}
        channel={channel}
        onChannelChange={setChannel}
        search={search}
        onSearchChange={setSearch}
      />
      <ScrollArea className="flex-1">
        {isLoading && (
          <div className="p-4 text-sm leading-snug text-muted-foreground">กำลังโหลด...</div>
        )}
        {isError && !isLoading && (
          <div className="p-4 text-sm leading-snug text-destructive">โหลดห้องแชทไม่สำเร็จ</div>
        )}
        {!isLoading && !isError && data.length === 0 && (
          <div className="p-4 text-sm leading-snug text-muted-foreground">ไม่มีห้องแชท</div>
        )}
        <div className="flex flex-col gap-1 p-1">
          {data.map((room) => (
            <RoomListItem
              key={room.id}
              room={room}
              active={room.id === activeRoomId}
              onClick={() => onSelect(room.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

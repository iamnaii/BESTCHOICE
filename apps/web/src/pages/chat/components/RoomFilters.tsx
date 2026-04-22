import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search } from 'lucide-react';
import type { ChannelFilter, RoomFilter } from '../lib/chat-api';

export function RoomFilters({
  filter,
  onFilterChange,
  channel,
  onChannelChange,
  search,
  onSearchChange,
}: {
  filter: RoomFilter;
  onFilterChange: (f: RoomFilter) => void;
  channel: ChannelFilter;
  onChannelChange: (c: ChannelFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2 border-b border-border p-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="ค้นหาชื่อ/เบอร์โทร"
          className="pl-9 leading-snug"
          aria-label="ค้นหาห้องแชท"
        />
      </div>
      <Tabs value={filter} onValueChange={(v) => onFilterChange(v as RoomFilter)}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1 leading-snug">ทั้งหมด</TabsTrigger>
          <TabsTrigger value="sales" className="flex-1 leading-snug">ขาย</TabsTrigger>
          <TabsTrigger value="service" className="flex-1 leading-snug">บริการ</TabsTrigger>
          <TabsTrigger value="handoff" className="flex-1 leading-snug">Handoff</TabsTrigger>
          <TabsTrigger value="sla_breach" className="flex-1 leading-snug">SLA</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={channel} onValueChange={(v) => onChannelChange(v as ChannelFilter)}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1 leading-snug">ทุกช่องทาง</TabsTrigger>
          <TabsTrigger value="LINE_FINANCE" className="flex-1 leading-snug">LINE</TabsTrigger>
          <TabsTrigger value="FACEBOOK" className="flex-1 leading-snug">Facebook</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

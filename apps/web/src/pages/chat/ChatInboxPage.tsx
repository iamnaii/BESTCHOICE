import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AssistantSidebar } from './components/AssistantSidebar';
import { ConversationPanel } from './components/ConversationPanel';
import { RoomList } from './components/RoomList';
import type { AiSettingsLite } from './components/RoomListItem';

export type AiStatusFilter = 'all' | 'ai' | 'human' | 'pending';

const AI_FILTER_LABELS: Record<AiStatusFilter, string> = {
  all: 'ทั้งหมด',
  ai: 'AI',
  human: 'พนักงาน',
  pending: 'รอตอบ',
};

export default function ChatInboxPage() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [aiFilter, setAiFilter] = useState<AiStatusFilter>('all');

  const aiSettingsQuery = useQuery<AiSettingsLite>({
    queryKey: ['ai-settings', 'lite'],
    queryFn: () =>
      api.get('/staff-chat/ai/settings').then((r: any) => {
        const d = r.data?.data ?? r.data;
        return {
          autoModeEnabled: d.aiAutoEnabled ?? d.autoModeEnabled ?? false,
          enabledChannels: d.aiAutoChannels ?? d.enabledChannels ?? [],
        };
      }),
  });

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background">
      <header className="border-b border-border bg-background px-4 py-3">
        <h1 className="text-xl font-semibold leading-snug text-foreground">รวมแชท</h1>
        <p className="text-sm leading-snug text-muted-foreground">
          ดูทุกห้องจาก LINE + Facebook ที่เดียว — AI ช่วยแนะนำคำตอบ
        </p>
      </header>
      <div className="flex gap-2 border-b border-border bg-background px-3 py-2">
        {(['all', 'ai', 'human', 'pending'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setAiFilter(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs leading-snug transition-colors',
              aiFilter === key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-accent',
            )}
          >
            {AI_FILTER_LABELS[key]}
          </button>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-[320px_1fr_360px] overflow-hidden">
        <RoomList
          activeRoomId={activeRoomId}
          onSelect={setActiveRoomId}
          aiFilter={aiFilter}
          aiSettings={aiSettingsQuery.data}
        />
        <ConversationPanel roomId={activeRoomId} />
        <AssistantSidebar roomId={activeRoomId} />
      </div>
    </div>
  );
}

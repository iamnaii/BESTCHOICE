import { useState } from 'react';
import { AssistantSidebar } from './components/AssistantSidebar';
import { ConversationPanel } from './components/ConversationPanel';
import { RoomList } from './components/RoomList';

export default function ChatInboxPage() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background">
      <header className="border-b border-border bg-background px-4 py-3">
        <h1 className="text-xl font-semibold leading-snug text-foreground">รวมแชท</h1>
        <p className="text-sm leading-snug text-muted-foreground">
          ดูทุกห้องจาก LINE + Facebook ที่เดียว — AI ช่วยแนะนำคำตอบ
        </p>
      </header>
      <div className="grid flex-1 grid-cols-[320px_1fr_360px] overflow-hidden">
        <RoomList activeRoomId={activeRoomId} onSelect={setActiveRoomId} />
        <ConversationPanel roomId={activeRoomId} />
        <AssistantSidebar roomId={activeRoomId} />
      </div>
    </div>
  );
}

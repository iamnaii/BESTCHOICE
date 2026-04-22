import { useState } from 'react';
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
        <div className="flex items-center justify-center bg-background p-4">
          <p className="text-sm leading-snug text-muted-foreground">
            เลือกห้องจากด้านซ้ายเพื่อดูการสนทนา
          </p>
        </div>
        <aside className="border-l border-border bg-card p-4" aria-label="แผงรายละเอียด" />
      </div>
    </div>
  );
}

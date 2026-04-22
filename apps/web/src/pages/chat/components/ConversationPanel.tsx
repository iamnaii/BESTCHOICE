import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble, type Message } from './MessageBubble';
import { ComposeBox } from './ComposeBox';
import { useRoomMessages } from '../hooks/useRoomMessages';

/**
 * ConversationPanel — the center column of the inbox.
 *
 * Renders the message stream for the selected room and a compose box so
 * staff can send replies as themselves (bypassing the AI draft flow).
 */
export function ConversationPanel({ roomId }: { roomId: string | null }) {
  const { data, isLoading, isError } = useRoomMessages(roomId);
  const messages = (data ?? []) as Message[];

  if (!roomId) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4">
        <p className="text-sm leading-snug text-muted-foreground">
          เลือกห้องจากด้านซ้ายเพื่อดูการสนทนา
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-4">
          {isLoading && (
            <div className="text-sm leading-snug text-muted-foreground">กำลังโหลด...</div>
          )}
          {isError && !isLoading && (
            <div className="text-sm leading-snug text-destructive">โหลดข้อความไม่สำเร็จ</div>
          )}
          {!isLoading && !isError && messages.length === 0 && (
            <div className="text-sm leading-snug text-muted-foreground">ยังไม่มีข้อความในห้องนี้</div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      </ScrollArea>
      <ComposeBox roomId={roomId} />
    </div>
  );
}

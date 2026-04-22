import { useQuery } from '@tanstack/react-query';
import { Hand } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AiDraftCard } from './AiDraftCard';
import { CustomerCard } from './CustomerCard';
import { useLatestDraft, useTakeOver } from '../hooks/useAiDraft';
import { fetchRoom } from '../lib/chat-api';

/**
 * AssistantSidebar — right column of the /chat inbox page.
 *
 * Composes three blocks:
 *   1. CustomerCard — if the room is linked to a customer.
 *   2. AiDraftCard  — if there's a pending AI draft (polled every 5s).
 *   3. Take-Over button — pauses AI for the room (sets `aiPaused=true`).
 *
 * Week 1 intentionally omits the "Suggested actions" block (Week 2 scope).
 */
export function AssistantSidebar({ roomId }: { roomId: string | null }) {
  const { data: draft } = useLatestDraft(roomId);
  const takeOver = useTakeOver();

  const { data: room } = useQuery({
    queryKey: ['chat-room', roomId],
    queryFn: () => (roomId ? fetchRoom(roomId) : Promise.resolve(null)),
    enabled: !!roomId,
    refetchInterval: 5000,
  });

  if (!roomId) {
    return (
      <aside
        className="flex h-full flex-col items-center justify-center border-l border-border bg-card p-4 text-sm leading-snug text-muted-foreground"
        aria-label="แผงรายละเอียด"
      >
        เลือกห้องเพื่อดูรายละเอียด
      </aside>
    );
  }

  const handleTakeOver = () => {
    takeOver.mutate(roomId, {
      onSuccess: () => toast.success('ถือห้องแล้ว AI จะหยุดตอบ'),
      onError: () => toast.error('ถือห้องไม่สำเร็จ'),
    });
  };

  return (
    <aside
      className="flex h-full flex-col gap-3 overflow-y-auto border-l border-border bg-card p-3"
      aria-label="แผงรายละเอียด"
    >
      {room?.customerId ? (
        <CustomerCard customerId={room.customerId} />
      ) : (
        <Card>
          <CardContent className="p-3">
            <div className="text-xs leading-snug text-muted-foreground">
              ยังไม่ได้จับคู่กับลูกค้าในระบบ
            </div>
            {room?.displayName && (
              <div className="mt-1 text-sm leading-snug text-foreground">{room.displayName}</div>
            )}
          </CardContent>
        </Card>
      )}

      {draft ? (
        <AiDraftCard draft={draft} roomId={roomId} />
      ) : (
        <Card>
          <CardContent className="p-3">
            <div className="text-xs leading-snug text-muted-foreground">
              ไม่มีข้อความร่างจาก AI ในขณะนี้
            </div>
          </CardContent>
        </Card>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={handleTakeOver}
        disabled={takeOver.isPending || room?.aiPaused === true}
        className="mt-auto"
      >
        <Hand className="mr-1 h-3 w-3" />
        {room?.aiPaused ? 'กำลังถือห้องอยู่' : 'ถือห้อง (หยุด AI)'}
      </Button>
    </aside>
  );
}

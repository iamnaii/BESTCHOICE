import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { sendStaffMessage } from '../lib/chat-api';
import { useInvalidateRoomMessages } from '../hooks/useRoomMessages';

/**
 * ComposeBox — lets the staff type and send a message to the customer.
 *
 * POSTs to `/staff-chat/rooms/:id/messages`, which routes through
 * `MessageRouterService.sendStaffMessage` (saves ChatMessage + pushes via
 * the channel adapter). Enter submits, Shift+Enter inserts a newline.
 */
export function ComposeBox({ roomId }: { roomId: string }) {
  const [text, setText] = useState('');
  const invalidate = useInvalidateRoomMessages();

  const mutation = useMutation({
    mutationFn: (body: { roomId: string; text: string }) =>
      sendStaffMessage(body.roomId, body.text),
    onSuccess: (res: any) => {
      // Backend returns { success, error? } so surface delivery failures even
      // when the HTTP call itself succeeded (e.g. LINE push quota exhausted).
      const payload = res?.data ?? res;
      if (payload && payload.success === false) {
        toast.error(payload.error ?? 'ส่งข้อความไม่สำเร็จ');
        return;
      }
      setText('');
      invalidate(roomId);
      toast.success('ส่งข้อความแล้ว');
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message ?? 'ส่งข้อความไม่สำเร็จ');
    },
  });

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || mutation.isPending) return;
    mutation.mutate({ roomId, text: trimmed });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border bg-card p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="พิมพ์ข้อความส่งเป็นพนักงาน... (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
        className="min-h-[64px] resize-none leading-snug"
        aria-label="พิมพ์ข้อความตอบลูกค้า"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs leading-snug text-muted-foreground">
          ข้อความจะส่งในชื่อคุณ ไม่ใช่ AI
        </span>
        <Button onClick={handleSend} disabled={!text.trim() || mutation.isPending} size="sm">
          <Send className="mr-2 h-4 w-4" aria-hidden="true" />
          ส่ง
        </Button>
      </div>
    </div>
  );
}

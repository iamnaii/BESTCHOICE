import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Image as ImageIcon, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLineChatPanel, useSendLineChatMessage, type LineChatMessage } from '../hooks/useLineChatPanel';

interface Props {
  customerId: string | null;
}

/**
 * LineChatPanel — embedded LINE chat viewer inside Customer 360.
 *
 * Visibility: caller (Customer360Panel) only mounts this when the customer
 * has a `lineId`; the panel itself shows an empty state when no LINE room
 * exists (lineId set but customer never tapped the bot).
 *
 * UX:
 *  - Newest at the bottom (chat-app convention). BE returns newest-first;
 *    we flatten + reverse for display.
 *  - "Load older" button at the top loads the next page (older messages).
 *  - Inline composer at the bottom posts via /staff-chat/customer/:id/messages
 *    which routes through the same MessageRouterService as the main inbox.
 *  - Polling 30s keeps the view fresh; instant delivery for the staff
 *    member who just sent because the mutation invalidates the query.
 */
export default function LineChatPanel({ customerId }: Props) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useLineChatPanel(customerId, !!customerId);

  const send = useSendLineChatMessage(customerId);

  // Flatten pages newest→oldest then reverse for chat-app order (oldest→newest).
  const ordered = useMemo<LineChatMessage[]>(() => {
    if (!data) return [];
    const all = data.pages.flatMap((p) => p.messages);
    return [...all].reverse();
  }, [data]);

  const roomId = data?.pages[0]?.roomId ?? null;

  // Auto-scroll to bottom on first load and when new outbound messages
  // arrive. When loading older messages preserve scroll position so the
  // user doesn't lose their place.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isFetchingNextPage) {
      prevScrollHeightRef.current = el.scrollHeight;
      return;
    }
    if (prevScrollHeightRef.current > 0) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = 0;
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [ordered.length, isFetchingNextPage]);

  function handleSend() {
    const text = draft.trim();
    if (!text || send.isPending) return;
    send.mutate(text, {
      onSuccess: () => setDraft(''),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send, Shift+Enter for newline — chat convention.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!customerId) return null;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mb-2" />
        <div className="text-sm leading-snug">กำลังโหลดประวัติแชท...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-5 text-sm text-destructive leading-snug">
        ไม่สามารถโหลดประวัติแชทได้
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[480px]">
      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-muted/30"
      >
        {hasNextPage && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="text-xs text-muted-foreground hover:text-foreground rounded-full border border-border px-3 py-1 disabled:opacity-50"
            >
              {isFetchingNextPage ? 'กำลังโหลด...' : 'โหลดข้อความเก่ากว่า'}
            </button>
          </div>
        )}
        {ordered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <MessageCircle className="size-8 opacity-40" />
            <div className="text-sm leading-snug">ยังไม่มีประวัติการสนทนา</div>
            {!roomId && (
              <div className="text-2xs leading-snug max-w-[240px] text-center">
                รอลูกค้าทักเข้ามาก่อน — ระบบจะสร้างห้องแชทให้อัตโนมัติ
              </div>
            )}
          </div>
        ) : (
          ordered.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3 bg-card">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={roomId ? 'พิมพ์ข้อความ... (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)' : 'รอลูกค้าทักเข้ามาก่อน'}
            disabled={!roomId || send.isPending}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            maxLength={2000}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={!roomId || !draft.trim() || send.isPending}
            size="sm"
            className="shrink-0"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: LineChatMessage }) {
  // STAFF and BOT messages are right-aligned (outbound from our side);
  // CUSTOMER and SYSTEM are left-aligned (inbound).
  const outbound = m.role === 'STAFF' || m.role === 'BOT';
  const time = new Date(m.createdAt).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-snug ${
          outbound
            ? 'bg-primary text-primary-foreground'
            : 'bg-card border border-border text-foreground'
        }`}
      >
        {m.type === 'IMAGE' && m.mediaUrl ? (
          <div className="flex items-center gap-1.5 text-xs opacity-80">
            <ImageIcon className="size-3.5" />
            <span>รูปภาพ</span>
          </div>
        ) : m.type === 'FILE' && m.mediaUrl ? (
          <div className="flex items-center gap-1.5 text-xs opacity-80">
            <FileText className="size-3.5" />
            <span>{m.text || 'ไฟล์แนบ'}</span>
          </div>
        ) : null}
        {m.text && m.type !== 'FILE' && (
          <div className="whitespace-pre-wrap break-words">{m.text}</div>
        )}
        <div
          className={`mt-1 text-2xs tabular-nums ${
            outbound ? 'text-primary-foreground/70' : 'text-muted-foreground'
          }`}
        >
          {m.staff?.name ? `${m.staff.name} · ` : ''}
          {time}
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import ConversationList from './components/ConversationList';
import ChatPanel from './components/ChatPanel';
import Customer360Panel from './components/Customer360Panel';
import { useChatSocket, type ChatMessageEvent } from './hooks/useChatSocket';
import { useNotificationPrefs } from './hooks/useNotificationPrefs';
import { useAuth } from '@/contexts/AuthContext';
import type { InboxTab } from './components/ChannelFilter';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

// Sound notification
const NOTIFICATION_SOUND_URL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU4GAAB/f39/f39/f39/f3+AgICBgYKCg4OEhIWFhoaHh4iIiYmKiouLjIyNjY6Oj4+QkJGRkpKTk5SUlZWWlpeXmJiZmZqam5ucnJ2dnp6fn6CgoaGioqOjpKSlpaampqeop6ioqamqqqqrq6ysra2urq+vsLCxsbKys7O0tLW1tra3t7i4ubm6uru7vLy9vb6+v7/AwMHBwsLDw8TExcXGxsfHyMjJycrKy8vMzM3Nzs7Pz9DQ0dHS0tPT1NTV1dbW19fY2NnZ2tra29vc3N3d3t7f3+Dg4eHi4uPj5OTl5ebm5+fo6Onp6urr6+zs7e3u7u/v8PDx8fLy8/P09PX19vb39/j4+fn6+vv7/Pz9/f7+/v7+/v7+';


/**
 * UnifiedInboxPage — 3-panel chat interface.
 *
 * Layout: ConversationList | ChatPanel | Customer360Panel
 * On mobile: shows one panel at a time.
 */
export default function UnifiedInboxPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [roomViewers, setRoomViewers] = useState<{ userId: string; userName: string }[]>([]);
  const [filters, setFilters] = useState<{
    tab: InboxTab;
    channels: string[];
    search?: string;
  }>({ tab: 'all', channels: [] });

  // Notification mute prefs (localStorage-persisted, no on-mount permission prompt)
  const { muteAll, toggleMuteAll, toggleRoomMute, isMuted } = useNotificationPrefs();

  // Play sound + show browser notification — muted rooms skip both sound and notification
  const notifyNewMessage = useCallback(
    (data: ChatMessageEvent) => {
      if (isMuted(data.roomId)) return; // global or per-room mute → silence sound + notification
      // Sound
      try {
        const audio = new Audio(NOTIFICATION_SOUND_URL);
        audio.volume = 0.3;
        audio.play().catch(() => {});
      } catch {}
      // Browser notification (only if granted + not the room you're viewing)
      if (
        'Notification' in window &&
        Notification.permission === 'granted' &&
        data.roomId !== activeRoomId
      ) {
        new Notification('ข้อความใหม่ — BESTCHOICE', {
          body: data.text?.substring(0, 100) || 'มีข้อความใหม่',
          icon: '/favicon.ico',
          tag: `chat-${data.roomId}`,
        });
      }
    },
    [activeRoomId, isMuted],
  );

  // Deferred permission: request only when the user turns notifications ON (un-mutes globally)
  const handleToggleMuteAll = useCallback(() => {
    const wasMuted = muteAll;
    toggleMuteAll();
    // Turning notifications ON → request permission on this user gesture (deferred from mount).
    // If blocked, the desktop notification stays off but in-app sound still works.
    if (wasMuted && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [muteAll, toggleMuteAll]);

  // Clear viewer banner when switching rooms so a stale banner doesn't flash.
  useEffect(() => {
    setRoomViewers([]);
  }, [activeRoomId]);

  // Mark messages as read when opening a room
  useEffect(() => {
    if (activeRoomId) {
      api.post(`/staff-chat/rooms/${activeRoomId}/read`).catch(() => {});
    }
  }, [activeRoomId]);

  // WebSocket for real-time updates
  const { joinRoom, leaveRoom, viewRoom, isCustomerTyping, status: connectionStatus } = useChatSocket({
    onNewMessage: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', data.roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      // Sound + browser notification
      if (data.role === 'CUSTOMER') {
        notifyNewMessage(data);
      }
    },
    onRoomUpdate: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      // Inbox-wide new-message alert. MESSAGE_NEW is room-scoped (only the open
      // room), so it can't drive notifications for other conversations. The
      // gateway broadcasts every inbound customer message to the whole inbox via
      // ROOM_UPDATE carrying role+text — use that to fire the sound + browser
      // notification for any room the user isn't currently viewing.
      if (data.role === 'CUSTOMER' && data.roomId !== activeRoomId) {
        notifyNewMessage(data);
      }
    },
    onViewers: (data) => {
      if (data.roomId === activeRoomId) {
        setRoomViewers(data.viewers ?? []);
      }
    },
    // onCollision intentionally dropped — the persistent banner (from onViewers)
    // replaces the one-shot toast.
    onSendFailed: (data) => {
      toast.error(`ส่งข้อความไปยังลูกค้าไม่สำเร็จ${data.error ? ` — ${data.error}` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['chat-messages', data.roomId] });
    },
  }, activeRoomId);

  // Fetch sessions — send search to backend; tab/channel filtering is client-side
  const sessionsQuery = useQuery({
    queryKey: ['chat-rooms', filters.search],
    queryFn: () =>
      api
        .get('/staff-chat/rooms', { params: { search: filters.search } })
        .then((r) => r.data),
  });

  // AI settings — drives the AI status badge in ConversationItem.
  // Shares the ['ai-settings', 'lite'] cache key with ChatInboxPage Phase A
  // so the two pages don't re-fetch when the user toggles between them.
  const aiSettingsQuery = useQuery<{ autoModeEnabled: boolean; enabledChannels: string[] }>({
    queryKey: ['ai-settings', 'lite'],
    queryFn: () =>
      api.get('/staff-chat/ai/settings').then((r: any) => ({
        autoModeEnabled: r.data?.aiAutoEnabled ?? false,
        enabledChannels: r.data?.aiAutoChannels ?? [],
      })),
  });

  // Fetch active room details
  const sessionQuery = useQuery({
    queryKey: ['chat-room', activeRoomId],
    queryFn: () =>
      api.get(`/staff-chat/rooms/${activeRoomId}`).then((r) => r.data),
    enabled: !!activeRoomId,
  });

  // Fetch messages for active room
  const messagesQuery = useQuery({
    queryKey: ['chat-messages', activeRoomId],
    queryFn: () =>
      api
        .get(`/staff-chat/rooms/${activeRoomId}/messages`, {
          params: { limit: 100 },
        })
        .then((r) => r.data),
    enabled: !!activeRoomId,
    refetchInterval: 5000, // Poll every 5s as fallback for WS
  });

  // Mutations
  const assignMutation = useMutation({
    mutationFn: ({ roomId, staffId }: { roomId: string; staffId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/assign`, { staffId }),
    onSuccess: () => {
      toast.success('มอบหมายแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (roomId: string) =>
      api.patch(`/staff-chat/rooms/${roomId}/resolve`),
    onSuccess: () => {
      toast.success('ปิดการสนทนาแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
    },
  });

  const returnToAIMutation = useMutation({
    mutationFn: (roomId: string) =>
      api.patch(`/staff-chat/rooms/${roomId}/return-to-ai`),
    onSuccess: () => {
      toast.success('ส่งกลับ Bot แล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
  });

  const transferMutation = useMutation({
    mutationFn: ({ roomId, staffId }: { roomId: string; staffId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/transfer`, { staffId }),
    onSuccess: () => {
      toast.success('โอนห้องสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
    },
  });

  // Handlers
  const handleSelectRoom = useCallback(
    (roomId: string) => {
      if (activeRoomId) leaveRoom(activeRoomId);
      setActiveRoomId(roomId);
      joinRoom(roomId);
      viewRoom(roomId);
    },
    [activeRoomId, joinRoom, leaveRoom],
  );

  // Send via HTTP — WS is unreliable behind some proxies, so HTTP is the
  // source of truth for sending. WS is still used to receive real-time updates.
  // Returns true only when the message was accepted, so the composer can keep
  // the typed text on failure instead of losing it.
  const sendRoomMessage = async (text: string): Promise<boolean> => {
    if (!activeRoomId) {
      toast.error('ไม่มีห้องสนทนาที่เปิดอยู่');
      return false;
    }
    let ok = false;
    try {
      const { data } = await api.post<{ success: boolean; error?: string }>(
        `/staff-chat/rooms/${activeRoomId}/messages`,
        { text },
      );
      if (data && data.success === false) {
        toast.error(`ส่งข้อความไม่สำเร็จ${data.error ? ` — ${data.error}` : ''}`);
      } else {
        ok = true;
      }
    } catch (err) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      toast.error(e?.response?.data?.error ?? e?.response?.data?.message ?? 'ส่งข้อความไม่สำเร็จ');
    }
    queryClient.invalidateQueries({ queryKey: ['chat-messages', activeRoomId] });
    // Refresh the conversation list too so the room bubbles to the top with the
    // just-sent message as its preview (otherwise the left list stays stale
    // until the next inbound message / poll).
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    return ok;
  };

  const handleSendMessage = useCallback(
    (text: string) => sendRoomMessage(text),
    [activeRoomId, queryClient],
  );

  const handleSendSticker = useCallback(
    ({ packageId, stickerId }: { packageId: number; stickerId: number }) => {
      void sendRoomMessage(`[sticker:${packageId}:${stickerId}]`);
    },
    [activeRoomId, queryClient],
  );

  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeRoomId) throw new Error('ไม่มี room');
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post(`/staff-chat/rooms/${activeRoomId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัพโหลดไฟล์เรียบร้อย');
      if (activeRoomId) {
        queryClient.invalidateQueries({ queryKey: ['chat-messages', activeRoomId] });
      }
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
        || (err instanceof Error ? err.message : 'อัพโหลดไม่สำเร็จ');
      toast.error(msg);
    },
  });

  const handleSendFile = useCallback(
    (file: File) => uploadFileMutation.mutate(file),
    [uploadFileMutation],
  );

  const customerId = sessionQuery.data?.customerId ?? null;

  // Exclude yourself so your own second tab never warns about you.
  const otherViewers = roomViewers.filter((v) => v.userId !== user?.id);

  return (
    <div className="h-dvh flex bg-card overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0">
      {/* Left panel: Conversation list */}
      <div className={`w-80 flex-shrink-0 min-h-0 ${activeRoomId ? 'hidden lg:flex lg:flex-col' : 'flex flex-col w-full lg:w-80'}`}>
        <QueryBoundary
          isLoading={sessionsQuery.isLoading}
          isError={sessionsQuery.isError}
          error={sessionsQuery.error}
          onRetry={() => sessionsQuery.refetch()}
        >
          <ConversationList
            sessions={sessionsQuery.data?.data ?? []}
            activeRoomId={activeRoomId}
            onSelectRoom={handleSelectRoom}
            isLoading={sessionsQuery.isLoading}
            filters={filters}
            onFiltersChange={setFilters}
            currentUserId={user?.id}
            aiSettings={aiSettingsQuery.data}
            connectionStatus={connectionStatus}
            muteAll={muteAll}
            onToggleMuteAll={handleToggleMuteAll}
          />
        </QueryBoundary>
      </div>

      {/* Center panel: Chat */}
      <div className={`flex-1 flex flex-col min-h-0 min-w-0 ${!activeRoomId ? 'hidden lg:flex' : 'flex'}`}>
        <ChatPanel
          session={sessionQuery.data}
          messages={messagesQuery.data ?? []}
          isLoadingMessages={messagesQuery.isLoading}
          isCustomerTyping={isCustomerTyping}
          onSendMessage={handleSendMessage}
          onSendFile={handleSendFile}
          onSendSticker={handleSendSticker}
          onBack={() => setActiveRoomId(null)}
          onAssign={(staffId) =>
            activeRoomId && assignMutation.mutate({ roomId: activeRoomId, staffId })
          }
          onTransfer={(staffId) =>
            activeRoomId && transferMutation.mutate({ roomId: activeRoomId, staffId })
          }
          onResolve={() => activeRoomId && resolveMutation.mutate(activeRoomId)}
          onReturnToAI={() => activeRoomId && returnToAIMutation.mutate(activeRoomId)}
          currentUserId={user?.id ?? ''}
          onShowCustomerInfo={() => setCustomerPanelOpen(true)}
          isUploadingFile={uploadFileMutation.isPending}
          otherViewers={otherViewers}
          roomMuted={isMuted(activeRoomId ?? undefined)}
          onToggleRoomMute={activeRoomId ? () => toggleRoomMute(activeRoomId) : undefined}
        />
      </div>

      {/* Right panel: Customer 360 — always visible on xl+ */}
      <div className="hidden xl:block">
        <Customer360Panel
          customerId={customerId}
          activeRoomId={activeRoomId}
          onSelectRoom={handleSelectRoom}
          session={sessionQuery.data}
        />
      </div>

      {/* Right panel as Drawer on < xl */}
      <Sheet open={customerPanelOpen} onOpenChange={setCustomerPanelOpen}>
        <SheetContent side="right" className="w-80 p-0 xl:hidden">
          <SheetTitle className="sr-only">ข้อมูลลูกค้า</SheetTitle>
          <Customer360Panel
            customerId={customerId}
            activeRoomId={activeRoomId}
            onSelectRoom={(id) => {
              handleSelectRoom(id);
              setCustomerPanelOpen(false);
            }}
            session={sessionQuery.data}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import ConversationList from './components/ConversationList';
import ChatPanel from './components/ChatPanel';
import Customer360Panel from './components/Customer360Panel';
import { useChatSocket } from './hooks/useChatSocket';
import { useAuth } from '@/contexts/AuthContext';
import type { InboxTab } from './components/ChannelFilter';

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
  const [filters, setFilters] = useState<{
    tab: InboxTab;
    channels: string[];
    search?: string;
  }>({ tab: 'all', channels: [] });

  // Request browser notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Play sound + show browser notification
  const notifyNewMessage = useCallback((data: any) => {
    // Sound
    try {
      const audio = new Audio(NOTIFICATION_SOUND_URL);
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch {}

    // Browser notification (if not focused on this session)
    if (
      'Notification' in window &&
      Notification.permission === 'granted' &&
      data.roomId !== activeRoomId
    ) {
      new Notification('ข้อความใหม่ — BESTCHOICE', {
        body: data.text?.substring(0, 100) || 'มีข้อความใหม่',
        icon: '/favicon.ico',
        tag: `chat-${data.roomId}`, // prevents duplicate notifications per room
      });
    }
  }, [activeRoomId]);

  // Mark messages as read when opening a room
  useEffect(() => {
    if (activeRoomId) {
      api.post(`/staff-chat/rooms/${activeRoomId}/read`).catch(() => {});
    }
  }, [activeRoomId]);

  // WebSocket for real-time updates
  const { joinRoom, leaveRoom, sendMessage, viewRoom, isCustomerTyping } = useChatSocket({
    onNewMessage: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', data.roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      // Sound + browser notification
      if (data.role === 'CUSTOMER') {
        notifyNewMessage(data);
      }
    },
    onRoomUpdate: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
    },
    onCollision: (data) => {
      const viewerNames = data.viewers?.map((v: any) => v.userName).join(', ');
      toast.warning(`⚠️ ${viewerNames} กำลังดูแชทนี้อยู่`);
    },
  }, activeRoomId);

  // Fetch sessions — send search to backend; tab/channel filtering is client-side
  const sessionsQuery = useQuery({
    queryKey: ['chat-sessions', filters.search],
    queryFn: () =>
      api
        .get('/staff-chat/rooms', { params: { search: filters.search } })
        .then((r: any) => r.data),
  });

  // Fetch active room details
  const sessionQuery = useQuery({
    queryKey: ['chat-session', activeRoomId],
    queryFn: () =>
      api.get(`/staff-chat/rooms/${activeRoomId}`).then((r: any) => r.data),
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
        .then((r: any) => r.data),
    enabled: !!activeRoomId,
    refetchInterval: 5000, // Poll every 5s as fallback for WS
  });

  // Mutations
  const assignMutation = useMutation({
    mutationFn: ({ roomId, staffId }: { roomId: string; staffId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/assign`, { staffId }),
    onSuccess: () => {
      toast.success('มอบหมายแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-session', activeRoomId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (roomId: string) =>
      api.patch(`/staff-chat/rooms/${roomId}/resolve`),
    onSuccess: () => {
      toast.success('ปิดการสนทนาแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-session', activeRoomId] });
    },
  });

  const returnToAIMutation = useMutation({
    mutationFn: (roomId: string) =>
      api.patch(`/staff-chat/rooms/${roomId}/return-to-ai`),
    onSuccess: () => {
      toast.success('ส่งกลับ Bot แล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
    },
  });

  const transferMutation = useMutation({
    mutationFn: ({ roomId, staffId }: { roomId: string; staffId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/transfer`, { staffId }),
    onSuccess: () => {
      toast.success('โอนห้องสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-session', activeRoomId] });
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

  const handleSendMessage = useCallback(
    (text: string) => {
      if (!activeRoomId) return;
      sendMessage(activeRoomId, text);
      // Optimistic: invalidate messages
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['chat-messages', activeRoomId] });
      }, 300);
    },
    [activeRoomId, sendMessage, queryClient],
  );

  const handleSendSticker = useCallback(
    ({ packageId, stickerId }: { packageId: number; stickerId: number }) => {
      if (!activeRoomId) return;
      sendMessage(activeRoomId, `[sticker:${packageId}:${stickerId}]`);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['chat-messages', activeRoomId] });
      }, 300);
    },
    [activeRoomId, sendMessage, queryClient],
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

  return (
    <div className="h-screen flex bg-card overflow-hidden">
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
        />
      </div>

      {/* Right panel: Customer 360 */}
      <div className="hidden xl:block">
        <Customer360Panel customerId={customerId} activeRoomId={activeRoomId} onSelectRoom={handleSelectRoom} />
      </div>
    </div>
  );
}

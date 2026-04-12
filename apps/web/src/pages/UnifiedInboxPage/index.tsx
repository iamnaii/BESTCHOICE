import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import ConversationList from './components/ConversationList';
import ChatPanel from './components/ChatPanel';
import Customer360Panel from './components/Customer360Panel';
import { useChatSocket } from './hooks/useChatSocket';

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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    channel?: string;
    sessionStatus?: string;
    search?: string;
  }>({});

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
      data.sessionId !== activeSessionId
    ) {
      new Notification('ข้อความใหม่ — BESTCHOICE', {
        body: data.text?.substring(0, 100) || 'มีข้อความใหม่',
        icon: '/favicon.ico',
        tag: `chat-${data.sessionId}`, // prevents duplicate notifications per session
      });
    }
  }, [activeSessionId]);

  // WebSocket for real-time updates
  const { joinSession, leaveSession, sendMessage, viewSession } = useChatSocket({
    onNewMessage: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', data.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      // Sound + browser notification
      if (data.role === 'CUSTOMER') {
        notifyNewMessage(data);
      }
    },
    onSessionUpdate: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
    },
    onCollision: (data) => {
      const viewerNames = data.viewers?.map((v: any) => v.userName).join(', ');
      toast.warning(`⚠️ ${viewerNames} กำลังดูแชทนี้อยู่`);
    },
  });

  // Fetch sessions
  const sessionsQuery = useQuery({
    queryKey: ['chat-sessions', filters],
    queryFn: () =>
      api
        .get('/staff-chat/sessions', { params: filters })
        .then((r: any) => r.data),
  });

  // Fetch active session details
  const sessionQuery = useQuery({
    queryKey: ['chat-session', activeSessionId],
    queryFn: () =>
      api.get(`/staff-chat/sessions/${activeSessionId}`).then((r: any) => r.data),
    enabled: !!activeSessionId,
  });

  // Fetch messages for active session
  const messagesQuery = useQuery({
    queryKey: ['chat-messages', activeSessionId],
    queryFn: () =>
      api
        .get(`/staff-chat/sessions/${activeSessionId}/messages`, {
          params: { limit: 100 },
        })
        .then((r: any) => r.data),
    enabled: !!activeSessionId,
    refetchInterval: 5000, // Poll every 5s as fallback for WS
  });

  // Mutations
  const assignMutation = useMutation({
    mutationFn: ({ sessionId, staffId }: { sessionId: string; staffId: string }) =>
      api.patch(`/staff-chat/sessions/${sessionId}/assign`, { staffId }),
    onSuccess: () => {
      toast.success('มอบหมายแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-session', activeSessionId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (sessionId: string) =>
      api.patch(`/staff-chat/sessions/${sessionId}/resolve`),
    onSuccess: () => {
      toast.success('ปิดการสนทนาแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chat-session', activeSessionId] });
    },
  });

  const returnToAIMutation = useMutation({
    mutationFn: (sessionId: string) =>
      api.patch(`/staff-chat/sessions/${sessionId}/return-to-ai`),
    onSuccess: () => {
      toast.success('ส่งกลับ Bot แล้ว');
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
    },
  });

  // Handlers
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (activeSessionId) leaveSession(activeSessionId);
      setActiveSessionId(sessionId);
      joinSession(sessionId);
      viewSession(sessionId);
    },
    [activeSessionId, joinSession, leaveSession],
  );

  const handleSendMessage = useCallback(
    (text: string) => {
      if (!activeSessionId) return;
      sendMessage(activeSessionId, text);
      // Optimistic: invalidate messages
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['chat-messages', activeSessionId] });
      }, 300);
    },
    [activeSessionId, sendMessage, queryClient],
  );

  const customerId = sessionQuery.data?.customerId ?? null;

  return (
    <div className="h-[calc(100vh-4rem)] flex bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Left panel: Conversation list */}
      <div className={`w-80 flex-shrink-0 ${activeSessionId ? 'hidden lg:flex lg:flex-col' : 'flex flex-col w-full lg:w-80'}`}>
        <QueryBoundary
          isLoading={sessionsQuery.isLoading}
          isError={sessionsQuery.isError}
          error={sessionsQuery.error}
          onRetry={() => sessionsQuery.refetch()}
        >
          <ConversationList
            sessions={sessionsQuery.data?.data ?? []}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            isLoading={sessionsQuery.isLoading}
            filters={filters}
            onFiltersChange={setFilters}
          />
        </QueryBoundary>
      </div>

      {/* Center panel: Chat */}
      <div className={`flex-1 flex flex-col ${!activeSessionId ? 'hidden lg:flex' : 'flex'}`}>
        <ChatPanel
          session={sessionQuery.data}
          messages={messagesQuery.data ?? []}
          isLoadingMessages={messagesQuery.isLoading}
          onSendMessage={handleSendMessage}
          onBack={() => setActiveSessionId(null)}
          onAssign={(staffId) =>
            activeSessionId && assignMutation.mutate({ sessionId: activeSessionId, staffId })
          }
          onResolve={() => activeSessionId && resolveMutation.mutate(activeSessionId)}
          onReturnToAI={() => activeSessionId && returnToAIMutation.mutate(activeSessionId)}
        />
      </div>

      {/* Right panel: Customer 360 */}
      <Customer360Panel customerId={customerId} />
    </div>
  );
}

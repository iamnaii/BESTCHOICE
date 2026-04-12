import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import ConversationList from './components/ConversationList';
import ChatPanel from './components/ChatPanel';
import Customer360Panel from './components/Customer360Panel';
import { useChatSocket } from './hooks/useChatSocket';

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

  // WebSocket for real-time updates
  const { joinSession, leaveSession, sendMessage } = useChatSocket({
    onNewMessage: (data) => {
      // Invalidate messages for the session
      queryClient.invalidateQueries({ queryKey: ['chat-messages', data.sessionId] });
      // Update session list (last message preview)
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
    },
    onSessionUpdate: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
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

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';

interface ChatSocketEvents {
  onNewMessage?: (data: any) => void;
  onSessionUpdate?: (data: any) => void;
  onTyping?: (data: any) => void;
  onPresence?: (data: any) => void;
}

/**
 * useChatSocket — connects to the /chat WebSocket namespace.
 *
 * Handles connection lifecycle, room joining, and event dispatching.
 * The socket is created once and reused across the inbox page.
 */
export function useChatSocket(events: ChatSocketEvents) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user) return;

    const socket = io('/chat', {
      auth: { userId: user.id, userName: user.name },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('chat:message:new', (data) => events.onNewMessage?.(data));
    socket.on('chat:session:update', (data) => events.onSessionUpdate?.(data));
    socket.on('chat:typing', (data) => events.onTyping?.(data));
    socket.on('chat:presence', (data) => events.onPresence?.(data));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.id]);

  const joinSession = useCallback((sessionId: string) => {
    socketRef.current?.emit('chat:join', { sessionId });
  }, []);

  const leaveSession = useCallback((sessionId: string) => {
    socketRef.current?.emit('chat:leave', { sessionId });
  }, []);

  const sendMessage = useCallback((sessionId: string, text: string) => {
    socketRef.current?.emit('chat:send', { sessionId, text });
  }, []);

  const startTyping = useCallback((sessionId: string) => {
    socketRef.current?.emit('chat:typing:start', { sessionId });
  }, []);

  const stopTyping = useCallback((sessionId: string) => {
    socketRef.current?.emit('chat:typing:stop', { sessionId });
  }, []);

  return { joinSession, leaveSession, sendMessage, startTyping, stopTyping };
}

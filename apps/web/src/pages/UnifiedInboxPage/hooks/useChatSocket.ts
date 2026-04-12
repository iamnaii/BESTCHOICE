import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { getAccessToken } from '@/lib/api';
import { API_URL } from '@/lib/env';

interface ChatSocketEvents {
  onNewMessage?: (data: any) => void;
  onSessionUpdate?: (data: any) => void;
  onTyping?: (data: any) => void;
  onPresence?: (data: any) => void;
}

// Resolve WebSocket base URL: in dev, API runs on port 3000
function getWsBaseUrl(): string {
  // If API_URL is absolute (e.g. https://api.example.com/api), use its origin
  if (API_URL.startsWith('http')) {
    return new URL(API_URL).origin;
  }
  // In dev, API_URL is "/api" (relative) — WS must connect to the API server directly
  return import.meta.env.VITE_WS_URL || 'http://localhost:3000';
}

/**
 * useChatSocket — connects to the /chat WebSocket namespace on the API server.
 *
 * Sends JWT access token in handshake for server-side verification.
 * Connection is non-blocking — failures are silently retried.
 */
export function useChatSocket(events: ChatSocketEvents) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user) return;

    const token = getAccessToken();
    if (!token) return;

    const socket = io(`${getWsBaseUrl()}/chat`, {
      auth: { token },
      transports: ['websocket'],  // Skip polling — avoids blocking on Vite proxy
      reconnectionAttempts: 3,
      reconnectionDelay: 3000,
      timeout: 5000,
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on('chat:message:new', (data) => events.onNewMessage?.(data));
    socket.on('chat:session:update', (data) => events.onSessionUpdate?.(data));
    socket.on('chat:typing', (data) => events.onTyping?.(data));
    socket.on('chat:presence', (data) => events.onPresence?.(data));
    socket.on('connect_error', () => {
      // Silent — reconnection handles retry
    });

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

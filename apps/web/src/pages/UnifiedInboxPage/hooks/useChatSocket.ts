import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { getAccessToken } from '@/lib/api';
import { API_URL } from '@/lib/env';

export interface ChatMessageEvent {
  roomId: string;
  role?: 'CUSTOMER' | 'STAFF' | 'AI';
  text?: string;
  messageId?: string;
}

export interface ChatRoomUpdateEvent {
  roomId: string;
}

export interface ChatTypingEvent {
  roomId: string;
  role?: 'CUSTOMER' | 'STAFF';
}

export interface ChatPresenceEvent {
  userId: string;
  userName?: string;
  status?: 'online' | 'offline';
}

export interface ChatViewer {
  userId: string;
  userName: string;
}

export interface ChatViewersEvent {
  roomId: string;
  viewers: ChatViewer[];
}

export interface ChatCollisionEvent {
  roomId: string;
  viewers: ChatViewer[];
}

export interface ChatSendFailedEvent {
  roomId: string;
  text: string;
  error?: string;
}

interface ChatSocketEvents {
  onNewMessage?: (data: ChatMessageEvent) => void;
  onRoomUpdate?: (data: ChatRoomUpdateEvent) => void;
  onTyping?: (data: ChatTypingEvent) => void;
  onPresence?: (data: ChatPresenceEvent) => void;
  onViewers?: (data: ChatViewersEvent) => void;
  onCollision?: (data: ChatCollisionEvent) => void;
  onSendFailed?: (data: ChatSendFailedEvent) => void;
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
export function useChatSocket(events: ChatSocketEvents, activeRoomId?: string | null) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [isCustomerTyping, setIsCustomerTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest activeRoomId + event handlers in refs so the socket effect
  // doesn't tear down on room switches or handler identity changes
  const activeRoomIdRef = useRef(activeRoomId);
  const eventsRef = useRef(events);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);
  useEffect(() => { eventsRef.current = events; }, [events]);

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

    socket.on('chat:message:new', (data) => eventsRef.current.onNewMessage?.(data));
    socket.on('chat:room:update', (data) => eventsRef.current.onRoomUpdate?.(data));
    socket.on('chat:typing', (data) => {
      eventsRef.current.onTyping?.(data);
      // Show customer typing indicator for active room
      if (data.roomId === activeRoomIdRef.current && data.role !== 'STAFF') {
        setIsCustomerTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setIsCustomerTyping(false), 5000);
      }
    });
    socket.on('chat:presence', (data) => eventsRef.current.onPresence?.(data));
    socket.on('chat:viewers', (data) => eventsRef.current.onViewers?.(data));
    socket.on('chat:collision', (data) => eventsRef.current.onCollision?.(data));
    socket.on('chat:message:send-failed', (data) =>
      eventsRef.current.onSendFailed?.(data),
    );
    socket.on('connect_error', () => {
      // Silent — reconnection handles retry
    });

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.id]);

  const joinRoom = useCallback((roomId: string) => {
    socketRef.current?.emit('chat:join', { roomId });
  }, []);

  const leaveRoom = useCallback((roomId: string) => {
    socketRef.current?.emit('chat:leave', { roomId });
  }, []);

  const sendMessage = useCallback((roomId: string, text: string) => {
    socketRef.current?.emit('chat:send', { roomId, text });
  }, []);

  const startTyping = useCallback((roomId: string) => {
    socketRef.current?.emit('chat:typing:start', { roomId });
  }, []);

  const stopTyping = useCallback((roomId: string) => {
    socketRef.current?.emit('chat:typing:stop', { roomId });
  }, []);

  const viewRoom = useCallback((roomId: string) => {
    socketRef.current?.emit('chat:view', { roomId });
  }, []);

  return { joinRoom, leaveRoom, sendMessage, startTyping, stopTyping, viewRoom, isCustomerTyping };
}

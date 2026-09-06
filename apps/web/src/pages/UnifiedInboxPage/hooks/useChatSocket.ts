import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { getAccessToken } from '@/lib/api';
import { API_URL } from '@/lib/env';

// Mirrors the backend MessageRole enum (schema.prisma) so role-based UI logic
// type-checks against what the gateway actually sends.
export type ChatRole = 'CUSTOMER' | 'STAFF' | 'BOT' | 'AUTO_TRIGGER' | 'SYSTEM';

export interface ChatMessageEvent {
  roomId: string;
  role?: ChatRole;
  text?: string;
  messageId?: string;
}

// The gateway's inbox-wide ROOM_UPDATE for a new message carries the message
// payload (role + text) alongside the roomId — see StaffChatGateway.emitNewMessage.
// State-change updates (assign/resolve) omit role, so consumers can tell them apart.
export interface ChatRoomUpdateEvent {
  roomId: string;
  role?: ChatRole;
  text?: string;
  messageId?: string;
}

export interface ChatTypingEvent {
  roomId: string;
  role?: 'CUSTOMER' | 'STAFF';
  userName?: string;
  isTyping?: boolean;
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
  /** โน้ตภายในของห้องเปลี่ยน (เพิ่ม/ลบ/ปัก/ปลด) — รีเฟรชโน้ต + โน้ตปักหมุดในห้องนั้น */
  onNoteChanged?: (data: { roomId: string; action: string; noteId?: string }) => void;
  onTyping?: (data: ChatTypingEvent) => void;
  onPresence?: (data: ChatPresenceEvent) => void;
  onViewers?: (data: ChatViewersEvent) => void;
  onCollision?: (data: ChatCollisionEvent) => void;
  onSendFailed?: (data: ChatSendFailedEvent) => void;
  onReconnect?: () => void;
}

// Resolve WebSocket base URL: in dev, API runs on port 3000
function getWsBaseUrl(): string {
  // If API_URL is absolute (e.g. https://api.example.com/api), use its origin
  if (API_URL.startsWith('http')) {
    return new URL(API_URL).origin;
  }
  // API_URL เป็น path สัมพัทธ์ทั้ง dev และ prod — เดิมตกไป localhost:3000 บน prod ⇒ socket ต่อไม่ติด
  // เสียง/แจ้งเตือน/typing ไม่เคยทำงานเลย (สเปก §9.4 แก้ไข 2026-09-05) · prod: API อยู่ origin เดียวกับหน้าเว็บ
  // และ gateway allowlist มีโดเมนนั้นอยู่แล้ว · dev: API แยกพอร์ต 3000 · VITE_WS_URL ยัง override ได้ทั้งคู่
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (import.meta.env.DEV) return 'http://localhost:3000';
  // prod: หน้าเว็บอยู่บน Firebase Hosting ซึ่ง rewrite ได้แค่ HTTP /api/** — WebSocket ต้องไปที่ API โดยตรง
  // (ไม่งั้น handshake ตกไป index.html → inbox ขึ้น "ออฟไลน์" ตลอด 2026-09-06)
  if (typeof window !== 'undefined' && /(^|\.)bestchoicephone\.app$/.test(window.location.hostname)) {
    return 'https://api.bestchoicephone.app';
  }
  return window.location.origin;
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
  const [staffTyping, setStaffTyping] = useState<{ userName: string } | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>(
    'connecting',
  );
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staffTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest activeRoomId + event handlers in refs so the socket effect
  // doesn't tear down on room switches or handler identity changes
  const activeRoomIdRef = useRef(activeRoomId);
  const eventsRef = useRef(events);
  const hasConnectedRef = useRef(false);
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
    setStaffTyping(null);
  }, [activeRoomId]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  useEffect(() => {
    if (!user) return;

    const token = getAccessToken();
    if (!token) return;

    const socket = io(`${getWsBaseUrl()}/chat`, {
      auth: { token },
      transports: ['websocket'],  // Skip polling — avoids blocking on Vite proxy
      // Cloud Run ปิด WS ทุกครั้งที่ครบ request timeout — ต้องต่อใหม่ได้เรื่อย ๆ ไม่ใช่ยอมแพ้หลัง 3 ครั้ง
      reconnectionAttempts: 30,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      timeout: 5000,
      autoConnect: true,
    });

    socketRef.current = socket;

    // Re-join the open room on every (re)connect. socket.io transparently
    // reconnects after a transient drop, but the server-side socket is brand new
    // and only auto-joins INBOX — without this the active room would stop
    // receiving message/typing/collision events until the user reselects it.
    socket.on('connect', () => {
      setStatus('connected');
      const roomId = activeRoomIdRef.current;
      if (roomId) {
        socket.emit('chat:join', { roomId });
        socket.emit('chat:view', { roomId });
      }
      if (hasConnectedRef.current) {
        eventsRef.current.onReconnect?.();
      }
      hasConnectedRef.current = true;
    });

    socket.on('chat:message:new', (data) => eventsRef.current.onNewMessage?.(data));
    socket.on('chat:room:update', (data) => eventsRef.current.onRoomUpdate?.(data));
    socket.on('chat:note:changed', (data) => eventsRef.current.onNoteChanged?.(data));
    socket.on('chat:typing', (data) => {
      eventsRef.current.onTyping?.(data);
      // Show customer typing indicator for active room
      if (data.roomId === activeRoomIdRef.current && data.role !== 'STAFF') {
        setIsCustomerTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setIsCustomerTyping(false), 5000);
      }
      if (data.roomId === activeRoomIdRef.current && data.role === 'STAFF') {
        if (data.isTyping) {
          setStaffTyping({ userName: data.userName ?? 'พนักงาน' });
          if (staffTypingTimerRef.current) clearTimeout(staffTypingTimerRef.current);
          staffTypingTimerRef.current = setTimeout(() => setStaffTyping(null), 5000);
        } else {
          if (staffTypingTimerRef.current) clearTimeout(staffTypingTimerRef.current);
          setStaffTyping(null);
        }
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
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    socket.io.on('reconnect_failed', () => setStatus('disconnected'));

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (staffTypingTimerRef.current) clearTimeout(staffTypingTimerRef.current);
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

  return { joinRoom, leaveRoom, sendMessage, startTyping, stopTyping, viewRoom, isCustomerTyping, staffTyping, status };
}

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { getAccessToken } from '@/lib/api';
import { API_URL } from '@/lib/env';

export interface InboundCallEvent {
  callId: string;
  callerNumber: string;
  customer: { id: string; name: string } | null;
  contract: { id: string; contractNumber: string } | null;
}

// Resolve WebSocket base URL — mirrors the pattern in useChatSocket
function getWsBaseUrl(): string {
  if (API_URL.startsWith('http')) {
    return new URL(API_URL).origin;
  }
  // Dev: API_URL is "/api/admin" — WS must connect to the API server directly
  return import.meta.env.VITE_WS_URL || 'http://localhost:3000';
}

/**
 * useYeastarSocket — subscribes to `yeastar:inbound` events from the /events namespace.
 *
 * Connection is non-blocking; if Yeastar is not configured the server simply
 * never emits the event, so this is a safe no-op for non-PBX deployments.
 */
export function useYeastarSocket(onInbound: (event: InboundCallEvent) => void) {
  const { user } = useAuth();
  const onInboundRef = useRef(onInbound);
  onInboundRef.current = onInbound;

  useEffect(() => {
    if (!user) return;

    const token = getAccessToken();
    if (!token) return;

    const socket: Socket = io(`${getWsBaseUrl()}/events`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 3,
      reconnectionDelay: 3000,
      timeout: 5000,
      autoConnect: true,
    });

    socket.on('yeastar:inbound', (data: InboundCallEvent) => {
      onInboundRef.current(data);
    });

    socket.on('connect_error', () => {
      // Silent — reconnection handles retry
    });

    return () => {
      socket.disconnect();
    };
  }, [user?.id]);
}

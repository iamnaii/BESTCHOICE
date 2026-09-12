import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { NOTIFICATION_SOUND_URL } from './components/notification-sound';
import AppointmentAlertBar from './components/AppointmentAlertBar';
import { apptState, nextAppointment } from './components/appointment';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import ConversationList, { type InboxFilters } from './components/ConversationList';
import { describeSendError, SEND_ERROR_WINDOW, SEND_ERROR_TOKEN } from './components/send-error';
import { buildRoomListParams } from './components/room-query';
import type { StaffOption } from './components/ChannelFilter';
import ChatPanel from './components/ChatPanel';
import RoomDossier from './components/RoomDossier';
import { useChatSocket, type ChatMessageEvent } from './hooks/useChatSocket';
import { useNotificationPrefs } from './hooks/useNotificationPrefs';
import { useAuth } from '@/contexts/AuthContext';
import type { InboxTab } from './components/ChannelFilter';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { resolveUploadFeedback } from './components/upload-feedback';
import { useRoomCredit } from './hooks/useRoomCredit';

// Sound notification


/**
 * UnifiedInboxPage — 3-panel chat interface.
 *
 * Layout: ConversationList | ChatPanel | RoomDossier (แผงขวา 3 แท็บ · ใช้บล็อกเดิมของ Customer360Panel ผ่านโหมด bare)
 * On mobile: shows one panel at a time.
 */
export default function UnifiedInboxPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { roomId: roomIdParam } = useParams<{ roomId: string }>();
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [creditFocus, setCreditFocus] = useState<{ roomId: string; tick: number } | null>(null);
  const activeCreditRoomRef = useRef(activeRoomId);
  activeCreditRoomRef.current = activeRoomId;
  const credit = useRoomCredit(activeRoomId, (attachedRoomId) => {
    const open = () => {
      navigate(`/inbox/${attachedRoomId}`);
      setCreditFocus({ roomId: attachedRoomId, tick: Date.now() });
      if (window.innerWidth < 1280) setCustomerPanelOpen(true);
    };
    if (attachedRoomId === activeCreditRoomRef.current && window.innerWidth >= 1280) {
      setCreditFocus({ roomId: attachedRoomId, tick: Date.now() });
    }
    toast.success('แนบไฟล์เพื่อตรวจเครดิตแล้ว', window.innerWidth < 1280 ? { action: { label: 'เปิดแผง', onClick: open } } : undefined);
  });
  const [roomViewers, setRoomViewers] = useState<{ userId: string; userName: string }[]>([]);
  // เจ้าของเคาะ 2026-09-05: ช่องทางเลือกทีละอัน · เมนูผู้ดูแลแทนเมนูบอท · view 'expired' = มุมมอง "ตอบไม่ทัน"
  const [filters, setFilters] = useState<InboxFilters>({ tab: 'waiting', channel: null, who: 'all', view: 'queue' });

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

  // Send-status state: in-flight ghosts (keyed by token) + unified failed list (both roomId-scoped)
  const [pendingSends, setPendingSends] = useState<
    { clientMessageId: string; roomId: string; text: string }[]
  >([]);
  const [failedSends, setFailedSends] = useState<
    { id: string; roomId: string; text: string; source: 'http' | 'ws'; clientMessageId: string; reason?: string }[]
  >([]);

  // reason = เหตุจริงที่แปลเป็นไทยแล้ว (สเปก §8.1: ส่งไม่ถึงต้องบอกว่าทำไม ไม่เงียบ)
  const pushFailedSend = useCallback(
    (roomId: string, text: string, source: 'http' | 'ws', clientMessageId: string, reason?: string) => {
      setFailedSends((prev) => {
        // avoid a double entry if HTTP-catch and WS send-failed both fire for the same text
        const dup = prev.find((f) => f.roomId === roomId && f.text === text);
        if (dup) {
          // ไม่เพิ่มฟองซ้ำ แต่เหตุที่ "ดีกว่า" ทับได้: เหตุจาก WS (adapter รู้จริง) หรือเหตุที่แปลได้ (พ้น 24 ชม./token)
          // ชนะข้อความ HTTP ทั่วไปที่มาก่อน
          const better =
            !!reason && (!dup.reason || source === 'ws' || reason === SEND_ERROR_WINDOW || reason === SEND_ERROR_TOKEN);
          return better ? prev.map((f) => (f === dup ? { ...f, reason } : f)) : prev;
        }
        return [...prev, { id: crypto.randomUUID(), roomId, text, source, clientMessageId, reason }];
      });
    },
    [],
  );

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

  // Debounced invalidator for the rooms list — coalesces rapid WS events (new message +
  // room update can fire within milliseconds of each other) into a single refetch.
  const roomsInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateRoomsListSoon = useCallback(() => {
    if (roomsInvalidateTimer.current) clearTimeout(roomsInvalidateTimer.current);
    roomsInvalidateTimer.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room-counts'] });
    }, 600);
  }, [queryClient]);
  // Clear any in-flight debounce timer on unmount to prevent a state update
  // (queryClient.invalidateQueries) from firing after the component is gone.
  useEffect(() => () => {
    if (roomsInvalidateTimer.current) clearTimeout(roomsInvalidateTimer.current);
  }, []);

  // WebSocket for real-time updates
  const { joinRoom, leaveRoom, viewRoom, startTyping, stopTyping, isCustomerTyping, staffTyping, status: connectionStatus } = useChatSocket({
    onNewMessage: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', data.roomId] });
      invalidateRoomsListSoon();
      // Sound + browser notification
      if (data.role === 'CUSTOMER') {
        notifyNewMessage(data);
      }
    },
    onRoomUpdate: (data) => {
      invalidateRoomsListSoon();
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
    onNoteChanged: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chat-notes', data.roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', data.roomId] });
    },
    onSendFailed: (data) => {
      pushFailedSend(data.roomId, data.text, 'ws', '', describeSendError(data.error) ?? undefined);
      queryClient.invalidateQueries({ queryKey: ['chat-messages', data.roomId] });
    },
    onReconnect: () => {
      // After a transient drop we missed live events — pull fresh state.
      if (activeRoomId) queryClient.invalidateQueries({ queryKey: ['chat-messages', activeRoomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room-counts'] });
    },
  }, activeRoomId);

  const currentUserId = user?.id;

  // Fetch sessions — send ALL active filters server-side so each filter combination
  // fetches the correctly filtered+sorted page set (queryKey=filters resets to page 1
  // on any filter change). useInfiniteQuery accumulates pages; "โหลดห้องเพิ่ม" appends.
  const sessionsQuery = useInfiniteQuery({
    queryKey: ['chat-rooms', filters],
    queryFn: ({ pageParam }) =>
      api
        .get('/staff-chat/rooms', {
          params: {
            page: pageParam,
            limit: 50,
            ...buildRoomListParams(filters, currentUserId),
          },
        })
        .then((r) => r.data),
    initialPageParam: 1,
    refetchInterval: 60_000,
    getNextPageParam: (lastPage: any) =>
      lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
  });

  const sessions = useMemo(() => {
    const flat = sessionsQuery.data?.pages.flatMap((p: any) => p.data ?? []) ?? [];
    // Offset pagination over a mutable lastMessageAt order can repeat a room at a
    // page boundary if rooms shift between fetches — dedup by id to avoid React
    // key collisions / double rows. Map preserves first-seen (server) order.
    const list = [...new Map(flat.map((r: any) => [r.id, r])).values()];
    // ห้องที่ถึงนัด/ใกล้ถึง (≤15 นาที) ลอยขึ้นบนสุด — ชั้น 1 (เจ้าของเคาะ 2026-09-06) · ลำดับเดิมคงที่ในแต่ละกลุ่ม
    const urgent = (r: any) => !!apptState(nextAppointment(r.todos)?.dueDate)?.urgent;
    return [...list.filter(urgent), ...list.filter((r) => !urgent(r))];
  }, [sessionsQuery.data?.pages]);

  // ตัวนับจากเซิร์ฟเวอร์ — นับทั้งจักรวาลห้อง ไม่ใช่แค่หน้าที่โหลดมา
  // ส่ง tab ไปด้วยเพราะเมนูช่องทางต้องนับในจักรวาลของแท็บที่เปิดอยู่
  // (ไม่งั้นเมนูบอกเลขทั้งบริษัทขณะที่รายการข้างล่างถูกกรองไปแล้ว)
  // ตัวกรองรายการ (ช่องทาง/ผู้ดูแล) ไม่ส่ง — เลขบนแท็บต้องคงที่ขณะกรอง (สเปก §7)
  const roomCountsQuery = useQuery({
    queryKey: ['chat-room-counts', filters.tab],
    queryFn: () =>
      api
        .get('/staff-chat/rooms/counts', { params: { tab: filters.tab } })
        .then((r) => r.data),
    refetchInterval: 60_000,
  });

  // รายชื่อพนักงานสำหรับเมนูผู้ดูแล — endpoint เดียวกับปุ่มมอบหมายใน SessionActions
  const staffQuery = useQuery({
    queryKey: ['staff-online'],
    queryFn: () => api.get('/staff-chat/staff/online').then((r) => r.data?.data ?? r.data),
    staleTime: 5 * 60_000,
  });
  const staffOptions = useMemo<StaffOption[]>(() => {
    const raw: any[] = Array.isArray(staffQuery.data) ? staffQuery.data : [];
    return raw
      .map((u) => ({
        id: String(u.id),
        // getAssignableStaff คืน {id, name, email, activeCount} — name ว่างให้ตกไปอีเมล
        name: u.name || u.email || String(u.id),
      }))
      .filter((u) => u.id && u.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [staffQuery.data]);

  // AI settings — drives the AI status badge in ConversationItem.
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
    // 403 = ห้องถูกเพื่อนรับไปแล้ว ไม่ใช่ความผิดพลาดชั่วคราว — retry ไปก็ได้ 403 เหมือนเดิม
    retry: (count, err: any) => (err?.response?.status === 403 ? false : count < 2),
  });
  const roomDenied = (sessionQuery.error as any)?.response?.status === 403;
  const roomDeniedMessage =
    (sessionQuery.error as any)?.response?.data?.message ??
    'ห้องนี้มีพนักงานคนอื่นดูแลอยู่ ขอให้เขาโอนให้ก่อนจึงจะเปิดได้';

  // Fetch messages for active room
  // โน้ตภายในของห้อง — รวมเข้าไทม์ไลน์กับข้อความ (สเปกแผงกลาง 2026-09-06)
  const notesQuery = useQuery({
    queryKey: ['chat-notes', activeRoomId],
    queryFn: () => api.get(`/staff-chat/rooms/${activeRoomId}/notes`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!activeRoomId,
  });
  const invalidateNotes = (roomId: string) => {
    queryClient.invalidateQueries({ queryKey: ['chat-notes', roomId] });
    queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
  };
  const addNoteMutation = useMutation({
    mutationFn: ({ roomId, content }: { roomId: string; content: string }) =>
      api.post(`/staff-chat/rooms/${roomId}/notes`, { content }).then((r) => r.data),
    onSuccess: (_d, v) => invalidateNotes(v.roomId),
    onError: () => toast.error('บันทึกโน้ตไม่สำเร็จ'),
  });
  const pinNoteMutation = useMutation({
    mutationFn: ({ roomId, noteId }: { roomId: string; noteId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/notes/${noteId}/pin`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateNotes(v.roomId),
    onError: () => toast.error('ปักหมุดไม่สำเร็จ'),
  });
  const unpinNoteMutation = useMutation({
    mutationFn: ({ roomId, noteId }: { roomId: string; noteId: string }) =>
      api.delete(`/staff-chat/rooms/${roomId}/notes/${noteId}/pin`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateNotes(v.roomId),
    onError: () => toast.error('ปลดหมุดไม่สำเร็จ'),
  });
  const deleteNoteMutation = useMutation({
    mutationFn: ({ roomId, noteId }: { roomId: string; noteId: string }) =>
      api.delete(`/staff-chat/rooms/${roomId}/notes/${noteId}`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateNotes(v.roomId),
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ลบโน้ตไม่สำเร็จ'),
  });

  const messagesQuery = useQuery({
    queryKey: ['chat-messages', activeRoomId],
    queryFn: () =>
      api
        .get(`/staff-chat/rooms/${activeRoomId}/messages`, {
          params: { limit: 100 },
        })
        .then((r) => r.data),
    enabled: !!activeRoomId,
    refetchInterval: connectionStatus === 'connected' ? 30000 : 5000, // Poll every 5s as fallback for WS
  });

  // Drop optimistic ghosts whose saved row (matched by clientMessageId) has
  // arrived in the message list. Belt to ChatPanel's display-time filter.
  useEffect(() => {
    const msgs = messagesQuery.data;
    if (!Array.isArray(msgs) || !activeRoomId) return;
    const landed = new Set(
      msgs.map((m: any) => m.clientMessageId).filter((id: unknown): id is string => !!id),
    );
    if (landed.size === 0) return;
    setPendingSends((prev) =>
      prev.filter((p) => !(p.roomId === activeRoomId && landed.has(p.clientMessageId))),
    );
  }, [messagesQuery.data, activeRoomId]);

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

  const reopenMutation = useMutation({
    mutationFn: (roomId: string) => api.patch(`/staff-chat/rooms/${roomId}/reopen`),
    onSuccess: (_data, roomId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
    },
    onError: () => toast.error('เลิกทำไม่สำเร็จ'),
  });

  const takeOverMutation = useMutation({
    mutationFn: (roomId: string) => api.post(`/chat-ai/take-over/${roomId}`),
    onSuccess: (_data, roomId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
    },
    onError: () => toast.error('สลับสถานะ AI ไม่สำเร็จ'),
  });

  const resolveMutation = useMutation({
    mutationFn: (roomId: string) => api.patch(`/staff-chat/rooms/${roomId}/resolve`),
    onSuccess: (_data, roomId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
      // ปิดงานแล้วเด้งไปห้องถัดไปในรายการ ให้ไล่คิวได้ต่อเนื่อง (เจ้าของเคาะ 2026-09-06) · เลิกทำ = กลับมาห้องเดิม
      if (roomId === activeRoomId) {
        const idx = sessions.findIndex((s) => s.id === roomId);
        const next = idx >= 0 ? (sessions[idx + 1] ?? sessions[idx - 1]) : undefined;
        navigate(next ? `/inbox/${next.id}` : '/inbox');
      }
      toast.success('ปิดแชทแล้ว', {
        action: {
          label: 'เลิกทำ',
          onClick: () => {
            reopenMutation.mutate(roomId);
            navigate(`/inbox/${roomId}`);
          },
        },
      });
    },
    onError: () => toast.error('ปิดแชทไม่สำเร็จ'),
  });

  const returnToAIMutation = useMutation({
    mutationFn: (roomId: string) => api.patch(`/staff-chat/rooms/${roomId}/return-to-ai`),
    onSuccess: (_data, roomId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
      toast.success('ส่งกลับ Bot แล้ว', {
        action: { label: 'เลิกทำ', onClick: () => takeOverMutation.mutate(roomId) },
      });
    },
    onError: () => toast.error('ส่งกลับ Bot ไม่สำเร็จ'),
  });

  const releaseToAiMutation = useMutation({
    mutationFn: (roomId: string) => api.post(`/chat-ai/release-to-ai/${roomId}`),
    onSuccess: (_data, roomId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
    },
    onError: () => toast.error('สลับสถานะ AI ไม่สำเร็จ'),
  });

  const aiTogglePending = takeOverMutation.isPending || releaseToAiMutation.isPending;
  const handleToggleAi = () => {
    if (!activeRoomId) return;
    if (sessionQuery.data?.aiPaused) releaseToAiMutation.mutate(activeRoomId);
    else takeOverMutation.mutate(activeRoomId);
  };

  const transferMutation = useMutation({
    mutationFn: ({ roomId, staffId }: { roomId: string; staffId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/transfer`, { staffId }),
    onSuccess: () => {
      toast.success('โอนห้องสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
      queryClient.invalidateQueries({ queryKey: ['staff-online'] });
    },
  });

  // Handlers
  // URL คือแหล่งความจริงของห้องที่เปิด (สเปก §7 ลิงก์ห้องใน URL) — เลือกห้อง = เปลี่ยน URL
  const handleSelectRoom = useCallback(
    (roomId: string) => navigate(`/inbox/${roomId}`),
    [navigate],
  );

  // param เปลี่ยน → ออกจากห้องเดิม เข้าห้องใหม่ (ครอบทั้งคลิกเลือก, ปุ่มย้อนกลับ, เปิดลิงก์ตรง, refresh)
  useEffect(() => {
    const next = roomIdParam ?? null;
    if (next === activeRoomId) return;
    if (activeRoomId) leaveRoom(activeRoomId);
    setActiveRoomId(next);
    if (next) {
      joinRoom(next);
      viewRoom(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ทำงานเฉพาะเมื่อ URL เปลี่ยน
  }, [roomIdParam]);

  // Send via HTTP — WS is unreliable behind some proxies, so HTTP is the
  // source of truth for sending. WS is still used to receive real-time updates.
  // Returns true only when the message was accepted. Failure drives a FAILED ghost
  // (via pushFailedSend) — no toast; the FAILED ghost is the affordance.
  const sendRoomMessage = async (text: string, reuseClientMessageId?: string): Promise<boolean> => {
    const roomId = activeRoomId;
    if (!roomId) return false;
    const clientMessageId = reuseClientMessageId || crypto.randomUUID();
    // Optimistic "กำลังส่ง" ghost — removed when the saved row (same token) lands
    // in the list, or on failure (replaced by a FAILED ghost).
    setPendingSends((prev) => [...prev, { clientMessageId, roomId, text }]);
    const removePending = () =>
      setPendingSends((prev) => prev.filter((p) => p.clientMessageId !== clientMessageId));
    try {
      const res = await api.post(`/staff-chat/rooms/${roomId}/messages`, { text, clientMessageId });
      const data = res.data;
      if (data && data.success === false) {
        removePending();
        pushFailedSend(roomId, text, 'http', clientMessageId, describeSendError(data.error ?? data.message) ?? undefined);
        return false;
      }
      // Success — keep the ghost until the refetched row carries the token, then
      // the reconciliation effect prunes it. Trigger the refetch now.
      queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
      // Refresh the conversation list too so the room bubbles to the top with the
      // just-sent message as its preview (otherwise the left list stays stale
      // until the next inbound message / poll).
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      return true;
    } catch (err: any) {
      removePending();
      const raw = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message;
      pushFailedSend(roomId, text, 'http', clientMessageId, describeSendError(raw) ?? undefined);
      return false;
    }
  };

  const sendRoomMessageRef = useRef(sendRoomMessage);
  sendRoomMessageRef.current = sendRoomMessage;

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

  // clientMessageId ต่อไฟล์ — คงค่าเดิมไว้ถ้า mutate() ถูกเรียกซ้ำด้วย File object
  // เดิม (เช่น retry ผ่าน react-query หรือ future retry-button ที่ถือ ref ของไฟล์
  // เดิมไว้) กันส่งรูปซ้ำให้ลูกค้า (idempotency contract จาก backend: unique
  // [roomId, clientMessageId] — ดู clientMessageIdRef ใน ProductPickerDialog.tsx
  // สำหรับ pattern เดียวกัน). ไฟล์ใหม่ (เลือก/ลากไฟล์ใหม่) เป็น File object คนละตัว
  // เสมอ จึงได้ id ใหม่โดยอัตโนมัติ — ไม่ต้อง reset ref เอง
  const uploadClientIdsRef = useRef(new WeakMap<File, string>());

  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeRoomId) throw new Error('ไม่มี room');
      let clientMessageId = uploadClientIdsRef.current.get(file);
      if (!clientMessageId) {
        clientMessageId = crypto.randomUUID();
        uploadClientIdsRef.current.set(file, clientMessageId);
      }
      const formData = new FormData();
      formData.append('file', file);
      // token กัน double-send เวลา retry (unique [roomId, clientMessageId] ฝั่ง DB)
      formData.append('clientMessageId', clientMessageId);
      const { data } = await api.post(`/staff-chat/rooms/${activeRoomId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data as { delivered?: boolean; error?: string };
    },
    onSuccess: (data) => {
      const feedback = resolveUploadFeedback(data);
      if (feedback.kind === 'success') {
        toast.success(feedback.message);
      } else if (feedback.kind === 'retryable') {
        toast.error(feedback.message);
      } else {
        toast.warning(feedback.message);
      }
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

  const retrySend = useCallback(
    (failedId: string, text: string) => {
      setFailedSends((prev) => {
        const entry = prev.find((f) => f.id === failedId);
        const reuse = entry?.clientMessageId || undefined;
        void sendRoomMessageRef.current(text, reuse);
        return prev.filter((f) => f.id !== failedId);
      });
    },
    [],
  );

  const customerId = sessionQuery.data?.customerId ?? null;

  // Exclude yourself so your own second tab never warns about you.
  const otherViewers = roomViewers.filter((v) => v.userId !== user?.id);

  return (
    <div className="h-dvh flex flex-col bg-card overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0">
      {/* แถบเตือนนัดเหนือทุกแผง (ชั้น 2 ท่า OBI apptAlert) — โผล่เฉพาะเมื่อมีนัดถึงเวลา/ใกล้ถึง */}
      <AppointmentAlertBar onGoToRoom={handleSelectRoom} />
      <div className="flex flex-1 min-h-0">
      {/* Left panel: Conversation list */}
      <div className={`w-80 flex-shrink-0 min-h-0 ${activeRoomId ? 'hidden lg:flex lg:flex-col' : 'flex flex-col w-full lg:w-80'}`}>
        <QueryBoundary
          isLoading={sessionsQuery.isLoading}
          isError={sessionsQuery.isError}
          error={sessionsQuery.error}
          onRetry={() => sessionsQuery.refetch()}
        >
          <ConversationList
            sessions={sessions}
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
            serverCounts={roomCountsQuery.data}
            staff={staffOptions}
            hasMore={sessionsQuery.hasNextPage}
            isLoadingMore={sessionsQuery.isFetchingNextPage}
            onLoadMore={() => sessionsQuery.fetchNextPage()}
          />
        </QueryBoundary>
      </div>

      {/* Center panel: Chat */}
      <div className={`flex-1 flex flex-col min-h-0 min-w-0 ${!activeRoomId ? 'hidden lg:flex' : 'flex'}`}>
        {roomDenied ? (
          /* เดิม sessionQuery ไม่มี error handling ⇒ 403 ทำให้ ChatPanel ได้ session = undefined
             แล้วเรนเดอร์หน้าว่าง "เลือกการสนทนา" เหมือนยังไม่ได้คลิกอะไร พนักงานจึงงงว่ากดไม่ติด
             ทั้งที่ห้องยังอยู่ในรายการของทุกคน (SALES เปิดห้องที่เพื่อนรับไปแล้วไม่ได้) */
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-sm text-center space-y-2">
              <Lock className="size-8 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">เปิดห้องนี้ไม่ได้</p>
              <p className="text-sm text-muted-foreground leading-snug">{roomDeniedMessage}</p>
            </div>
          </div>
        ) : (
        <ChatPanel
          session={sessionQuery.data}
          messages={messagesQuery.data ?? []}
          notes={Array.isArray(notesQuery.data) ? notesQuery.data : []}
          pinnedNote={sessionQuery.data?.notes?.[0] ?? null}
          currentUserRole={user?.role}
          onAddNote={async (content) => {
            if (!activeRoomId) return false;
            await addNoteMutation.mutateAsync({ roomId: activeRoomId, content });
            return true;
          }}
          onPinNote={(noteId) => activeRoomId && pinNoteMutation.mutate({ roomId: activeRoomId, noteId })}
          onUnpinNote={(noteId) => activeRoomId && unpinNoteMutation.mutate({ roomId: activeRoomId, noteId })}
          onDeleteNote={(noteId) => activeRoomId && deleteNoteMutation.mutate({ roomId: activeRoomId, noteId })}
          isLoadingMessages={messagesQuery.isLoading}
          isCustomerTyping={isCustomerTyping}
          onStartTyping={() => activeRoomId && startTyping(activeRoomId)}
          onStopTyping={() => activeRoomId && stopTyping(activeRoomId)}
          staffTypingName={staffTyping?.userName ?? null}
          onSendMessage={handleSendMessage}
          onSendFile={handleSendFile}
          onSendSticker={handleSendSticker}
          onBack={() => navigate('/inbox')}
          onAssign={(staffId) =>
            activeRoomId && assignMutation.mutate({ roomId: activeRoomId, staffId })
          }
          onTransfer={(staffId) =>
            activeRoomId && transferMutation.mutate({ roomId: activeRoomId, staffId })
          }
          onResolve={() => activeRoomId && resolveMutation.mutate(activeRoomId)}
          onReopen={() => activeRoomId && reopenMutation.mutate(activeRoomId)}
          reopenPending={reopenMutation.isPending}
          onReturnToAI={() => activeRoomId && returnToAIMutation.mutate(activeRoomId)}
          currentUserId={user?.id ?? ''}
          onShowCustomerInfo={() => setCustomerPanelOpen(true)}
          onCreditMessage={credit.toggleMessage}
          creditMessageIds={credit.files.flatMap(file => file.sourceMessageId ? [file.sourceMessageId] : [])}
          creditBusy={credit.busy}
          isUploadingFile={uploadFileMutation.isPending}
          otherViewers={otherViewers}
          roomMuted={isMuted(activeRoomId ?? undefined)}
          onToggleRoomMute={activeRoomId ? () => toggleRoomMute(activeRoomId) : undefined}
          aiPaused={sessionQuery.data?.aiPaused ?? false}
          onToggleAi={handleToggleAi}
          aiTogglePending={aiTogglePending}
          pendingSends={pendingSends.filter((p) => p.roomId === activeRoomId)}
          failedSends={failedSends.filter((f) => f.roomId === activeRoomId)}
          onRetrySend={retrySend}
        />
        )}
      </div>

      {/* Right panel: RoomDossier (โครง OBI · 3 แท็บ) — always visible on xl+ */}
      <div className="hidden xl:block">
        <RoomDossier
          credit={credit}
          creditFocus={creditFocus}
          room={sessionQuery.data}
          customerId={customerId}
          activeRoomId={activeRoomId}
          onSelectRoom={handleSelectRoom}
        />
      </div>

      {/* Right panel as Drawer on < xl */}
      <Sheet open={customerPanelOpen} onOpenChange={setCustomerPanelOpen}>
        <SheetContent side="right" className="w-80 p-0 xl:hidden">
          <SheetTitle className="sr-only">ข้อมูลลูกค้า</SheetTitle>
          <RoomDossier
            credit={credit}
            creditFocus={creditFocus}
            room={sessionQuery.data}
            customerId={customerId}
            activeRoomId={activeRoomId}
            onSelectRoom={(id) => {
              handleSelectRoom(id);
              setCustomerPanelOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
      </div>
    </div>
  );
}

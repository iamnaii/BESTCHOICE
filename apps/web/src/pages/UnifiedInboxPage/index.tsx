import { useRoomNotes } from './hooks/useRoomNotes';
import { useRoomActions } from './hooks/useRoomActions';
import { useRoomMessages } from './hooks/useRoomMessages';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { NOTIFICATION_SOUND_URL } from './components/notification-sound';
import { showChatNotification, requestNotificationPermissionIfNeeded } from './components/chat-notification';
import AppointmentAlertBar from './components/AppointmentAlertBar';
import { apptState, nextAppointment } from './components/appointment';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import ConversationList, { type InboxFilters } from './components/ConversationList';
import { describeSendError } from './components/send-error';
import { buildRoomListParams } from './components/room-query';
import type { StaffOption } from './components/ChannelFilter';
import ChatPanel from './components/ChatPanel';
import RoomDossier from './components/RoomDossier';
import { useChatSocket, type ChatMessageEvent } from './hooks/useChatSocket';
import { useNotificationPrefs } from './hooks/useNotificationPrefs';
import { useAuth } from '@/contexts/AuthContext';
import type { InboxTab } from './components/ChannelFilter';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useRoomCredit } from './hooks/useRoomCredit';
import { useFinanceApplication } from './hooks/useFinanceApplication';
import GfinSlotPicker from './components/gfin/GfinSlotPicker';
import { slotCounts, pickableAttachedIds, OPEN_STATUSES, type FinanceSlot } from './components/gfin/gfin';

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
  const gfin = useFinanceApplication(activeRoomId);
  const [slotPick, setSlotPick] = useState<{ roomId: string; messageId: string } | null>(null);
  const [gfinFocus, setGfinFocus] = useState<{ roomId: string; tick: number } | null>(null);
  /* กดปุ่ม GFIN ข้างรูป / ลากมาวาง: ยังไม่มีใบยื่น → สร้างร่างก่อนแล้วค่อยถามช่อง (mockup PickSlot)
     หยิบซ้ำ = เอาออก (spec §6.4 — เหมือนตรวจเครดิต) เฉพาะไฟล์ที่ยังไม่ถูกส่ง; ส่งแล้วต้องเลือกช่องใหม่แทน */
  /* ใบปัจจุบันอาจเป็นใบที่ปิดแล้ว (ใบล่าสุดของห้อง — I1) — หยิบรูปต้องลงใบที่ยังเปิดเท่านั้น ไม่งั้นเริ่มใบใหม่ */
  const openGfin = gfin.current && OPEN_STATUSES.includes(gfin.current.status) ? gfin.current : null;
  const pickSlotForMessage = async (messageId: string) => {
    if (!activeRoomId) return;
    const attached = openGfin?.files.find(f => f.sourceMessageId === messageId && !f.sentAt);
    if (attached) { try { await gfin.removeFile(attached.id); } catch { /* toast จาก hook */ } return; }
    if (!openGfin) { try { await gfin.start(); } catch { return; } }
    setSlotPick({ roomId: activeRoomId, messageId });
  };
  const onSlotPicked = async (slot: FinanceSlot) => {
    if (!slotPick) return;
    setSlotPick(null);
    try { await gfin.attachMessage(slotPick.messageId, slot); } catch { return; /* toast จาก hook */ }
    setGfinFocus({ roomId: slotPick.roomId, tick: Date.now() });
    if (window.innerWidth < 1280) setCustomerPanelOpen(true);
  };
  // สลับห้องระหว่างที่ picker ยังเปิดค้างอยู่ (เช่น กด GFIN แล้วไม่ทันเลือกช่องก่อนสลับห้อง)
  // ต้องเคลียร์คำขอเดิมทิ้ง ไม่งั้นกลับมาห้องเดิมทีหลัง picker จะโผล่ถามช่องของข้อความเก่าอีกครั้ง
  useEffect(() => { setSlotPick(null); }, [activeRoomId]);
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
      // ผ่าน service worker — `new Notification()` ตรง ๆ โยน error บน Chrome Android
      // ⇒ เดิมแจ้งเตือนบนมือถือไม่เคยเด้ง (ดู chat-notification.ts)
      if (data.roomId !== activeRoomId) {
        void showChatNotification({ roomId: data.roomId, text: data.text });
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
    if (wasMuted) requestNotificationPermissionIfNeeded();
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

  const { notesQuery, addNoteMutation, pinNoteMutation, unpinNoteMutation, deleteNoteMutation } =
    useRoomNotes(activeRoomId);
  const {
    assignMutation, transferMutation, resolveMutation, reopenMutation,
    returnToAIMutation, aiTogglePending, handleToggleAi,
  } = useRoomActions(activeRoomId, sessions, sessionQuery.data?.aiPaused ?? false);
  const {
    messagesQuery, pendingSends, failedSends, pushFailedSend, handleSendMessage,
    handleSendSticker, handleSendFile, retrySend, isUploadingFile,
  } = useRoomMessages(activeRoomId, connectionStatus);

  // Handlers
  // URL คือแหล่งความจริงของห้องที่เปิด (สเปก §7 ลิงก์ห้องใน URL) — เลือกห้อง = เปลี่ยน URL
  // เดิมขอสิทธิ์แจ้งเตือนเฉพาะตอนกดเปิดเสียงจากที่ปิดอยู่ ⇒ คนที่เสียงเปิดอยู่แล้วตั้งแต่แรก
  // (ค่าเริ่มต้น) ไม่มีวันถูกขอ แจ้งเตือนจึงไม่เคยทำงานสำหรับคนส่วนใหญ่
  // การคลิกเปิดห้องแชทเป็น user gesture ที่เบราว์เซอร์ยอมให้ขอสิทธิ์ และเข้าบริบทพอดี
  // ถามครั้งเดียวต่อรอบ — ถ้าผู้ใช้กดไม่อนุญาต เบราว์เซอร์จะไม่ถามซ้ำเองอยู่แล้ว
  const askedNotifyRef = useRef(false);
  const handleSelectRoom = useCallback(
    (roomId: string) => {
      if (!askedNotifyRef.current) {
        askedNotifyRef.current = true;
        requestNotificationPermissionIfNeeded();
      }
      navigate(`/inbox/${roomId}`);
    },
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
          onGfinMessage={pickSlotForMessage}
          gfinMessageIds={pickableAttachedIds(openGfin?.files ?? [])}
          gfinBusy={gfin.busy}
          isUploadingFile={isUploadingFile}
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
          gfin={gfin}
          gfinFocus={gfinFocus}
          onPickSlot={pickSlotForMessage}
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
            gfin={gfin}
            gfinFocus={gfinFocus}
            onPickSlot={pickSlotForMessage}
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
      <GfinSlotPicker
        open={!!slotPick && slotPick.roomId === activeRoomId}
        onOpenChange={(o) => !o && setSlotPick(null)}
        counts={slotCounts(openGfin?.files ?? [])}
        onPick={onSlotPicked}
      />
    </div>
  );
}

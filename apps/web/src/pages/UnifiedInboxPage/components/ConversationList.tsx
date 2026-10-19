import { useState, useEffect, useMemo, useCallback } from 'react';
import { nextRoomIndex } from './list-nav';
import { isEditableTarget } from '../hooks/useKeyboardShortcuts';
import {
  MoreHorizontal,
  Search,
  MessageCircle,
  X,
  Bell,
  BellOff,
  CheckCheck,
  Loader2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { toast } from 'sonner';
import ConversationItem from './ConversationItem';
import ChannelFilter, {
  ActiveInboxFilters,
  InboxTabs,
  type InboxTab,
  type WhoFilter,
  type StaffOption,
} from './ChannelFilter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deriveTabCounts, deriveChannelCounts } from './tab-counts';
import QueryBoundary from '@/components/QueryBoundary';

/** รูปตัวกรองของกล่องข้อความ — เจ้าของเคาะ 2026-09-05: ช่องทางเลือกทีละอัน · เมนูผู้ดูแลแทนเมนูบอท
 *  view: 'expired' = มุมมอง "ตอบไม่ทัน" (ห้อง FB ที่รอและพ้น 24 ชม.) เข้าได้จากบรรทัดสถานะของแท็บรอตอบเท่านั้น */
export interface InboxFilters {
  tab: InboxTab;
  channel: string | null;
  who: WhoFilter;
  view: 'queue' | 'expired';
  search?: string;
}

interface ConversationListProps {
  sessions: any[];
  activeRoomId: string | null;
  onSelectRoom: (roomId: string, messageId?: string) => void;
  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  filters: InboxFilters;
  onFiltersChange: (filters: InboxFilters) => void;
  currentUserId?: string;
  /** พนักงานสำหรับเมนูผู้ดูแล (จาก GET /staff-chat/staff/online) */
  staff?: StaffOption[];
  aiSettings?: { autoModeEnabled: boolean; enabledChannels: string[] };
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  muteAll?: boolean;
  onToggleMuteAll?: () => void;
  serverCounts?: {
    mine: number;
    all: number;
    waiting: number;
    expired?: number;
    byChannel: Record<string, number>;
  };
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export default function ConversationList({
  sessions,
  activeRoomId,
  onSelectRoom,
  isLoading,
  isError = false,
  error,
  onRetry,
  filters,
  onFiltersChange,
  currentUserId,
  staff,
  aiSettings,
  connectionStatus,
  muteAll,
  onToggleMuteAll,
  serverCounts,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: ConversationListProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);

  const queryClient = useQueryClient();
  const pinMutation = useMutation({
    mutationFn: ({ roomId, isPinned }: { roomId: string; isPinned: boolean }) =>
      isPinned
        ? api.delete(`/staff-chat/rooms/${roomId}/pin`)
        : api.post(`/staff-chat/rooms/${roomId}/pin`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
  });
  // pinMutation.mutate is stable across renders; pinMutation object is not.
  // Capturing the stable mutate fn keeps handlePin's identity stable so
  // ConversationItem's React.memo actually hits on every render.
  const pinMutate = pinMutation.mutate;

  const handlePin = useCallback(
    (roomId: string, isPinned: boolean) => pinMutate({ roomId, isPinned }),
    [pinMutate],
  );

  // Update parent filter when debounced search changes
  useEffect(() => {
    const normalizedDebounced = debouncedSearch || undefined;
    if (normalizedDebounced !== filters.search) {
      onFiltersChange({ ...filters, search: normalizedDebounced });
    }
  }, [debouncedSearch]);

  // Server already filters and sorts — just pass through.
  // (tabCounts/channelCounts memos below are kept as serverCounts fallback.)
  const visibleRooms = sessions;

  // ตัวกรอง "รายการ" (ช่องทาง/ผู้ดูแล) ไม่แตะเลขบนแท็บ — แต่ต้องบอกหน้าว่างให้ตรงความจริง
  // แท็บของฉันล็อกผู้ดูแลเป็นตัวเองอยู่แล้ว เมนูผู้ดูแลจึงไม่นับเป็นตัวกรอง
  const listFilterActive =
    filters.channel !== null || (filters.tab !== 'mine' && filters.who !== 'all');
  const expiredCount = serverCounts?.expired ?? 0;
  const allClear =
    filters.tab === 'waiting' && filters.view !== 'expired' && !filters.search && !listFilterActive;

  const tabCounts = useMemo(
    () => deriveTabCounts(sessions, currentUserId),
    [sessions, currentUserId],
  );
  const channelCounts = useMemo(() => deriveChannelCounts(sessions), [sessions]);

  const unreadInView = useMemo(
    () => visibleRooms.filter((r) => (r.unreadCount ?? 0) > 0).map((r) => r.id),
    [visibleRooms],
  );

  const markAllReadMutation = useMutation({
    mutationFn: (roomIds: string[]) =>
      api.post('/staff-chat/rooms/read-all', { roomIds }).then((r) => r.data),
    onSuccess: (data: { count?: number }) => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      toast.success(`ทำเครื่องหมายอ่านแล้ว ${data?.count ?? 0} ห้อง`);
    },
    onError: () => toast.error('ทำเครื่องหมายอ่านไม่สำเร็จ'),
  });

  // j/k navigate the visible (server-filtered) room list; guarded so it never
  // fires while typing in the composer or search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isLoading || isError) return;
      if (
        isEditableTarget(e.target) ||
        (e.target instanceof HTMLElement &&
          e.target.closest('[role=dialog], [role=menu], [role=listbox]'))
      )
        return;
      if (e.key !== 'j' && e.key !== 'k') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      const idx = visibleRooms.findIndex((r: any) => r.id === activeRoomId);
      const next = nextRoomIndex(idx, e.key === 'j' ? 1 : -1, visibleRooms.length);
      if (next < 0) return;
      const room = visibleRooms[next];
      onSelectRoom(room.id, room.searchMatch?.id);
      document.querySelector(`[data-room-id="${room.id}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleRooms, activeRoomId, onSelectRoom, isLoading, isError]);

  const filterProps = {
    activeTab: filters.tab,
    channel: filters.channel,
    who: filters.who,
    staff: staff ?? [],
    currentUserId,
    onApply: (values: { channel: string | null; who: WhoFilter }) =>
      onFiltersChange({ ...filters, ...values }),
  };

  return (
    <div className="inbox-queue flex h-full min-h-0 flex-col border-r border-border">
      <div className="inbox-queue-heading">
        <div className="inbox-queue-title-row">
          <div className="min-w-0"><h2 className="inbox-queue-title">กล่องข้อความ</h2>{typeof serverCounts?.all === 'number' && <p className="text-xs leading-snug text-muted-foreground">ทั้งหมด {serverCounts.all.toLocaleString('th-TH')} ห้อง</p>}</div>
          <div className="flex shrink-0 items-center gap-1">
            {onToggleMuteAll && (
              <button
                type="button"
                data-ui-control="button"
                data-ui-icon="true"
                className="inbox-queue-icon"
                onClick={onToggleMuteAll}
                aria-pressed={muteAll ?? false}
                aria-label={muteAll ? 'เปิดการแจ้งเตือน' : 'ปิดการแจ้งเตือน'}
                title={muteAll ? 'เปิดการแจ้งเตือน' : 'ปิดการแจ้งเตือน'}
              >
                {muteAll ? (
                  <BellOff className="size-5" aria-hidden="true" />
                ) : (
                  <Bell className="size-5" aria-hidden="true" />
                )}
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-ui-control="button"
                  data-ui-icon="true"
                  className="inbox-queue-icon"
                  aria-label="เครื่องมือกล่องข้อความ"
                  title="เครื่องมือกล่องข้อความ"
                >
                  {markAllReadMutation.isPending ? (
                    <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <MoreHorizontal className="size-5" aria-hidden="true" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                <DropdownMenuItem
                  disabled={unreadInView.length === 0 || markAllReadMutation.isPending}
                  onSelect={() => markAllReadMutation.mutate(unreadInView)}
                  className="min-h-11"
                >
                  <CheckCheck aria-hidden="true" /> ทำเครื่องหมายว่าอ่านแล้ว
                </DropdownMenuItem>
                <DropdownMenuLabel className="font-normal">
                  เฉพาะแชทที่โหลดในมุมมองนี้
                </DropdownMenuLabel>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {connectionStatus && connectionStatus !== 'connected' && (
          <p
            role="status"
            className={cn(
              'inbox-queue-connection',
              connectionStatus === 'disconnected' ? 'text-destructive' : 'text-warning-strong',
            )}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
            {connectionStatus === 'disconnected'
              ? 'ออฟไลน์ · กำลังลองเชื่อมต่อ'
              : connectionStatus === 'reconnecting'
                ? 'กำลังเชื่อมต่อใหม่…'
                : 'กำลังเชื่อมต่อ…'}
          </p>
        )}
        <div className="inbox-queue-search-row">
          <div className="inbox-queue-search">
            <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              data-inbox-search-input
              type="text"
              placeholder="ค้นหาชื่อ เบอร์ หรือข้อความ"
              aria-label="ค้นหาชื่อ เบอร์โทร หรือข้อความในแชท"
              maxLength={200}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput.length > 0 && (
              <button
                type="button"
                className="inbox-queue-icon"
                aria-label="ล้างการค้นหา"
                onClick={() => {
                  setSearchInput('');
                  onFiltersChange({ ...filters, search: undefined });
                }}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <ChannelFilter
            {...filterProps}
            channelCounts={
              filters.view === 'expired'
                ? channelCounts
                : (serverCounts?.byChannel ?? channelCounts)
            }
          />
        </div>
        <InboxTabs
          activeTab={filters.tab}
          counts={serverCounts ?? tabCounts}
          onTabChange={(tab) =>
            onFiltersChange({
              ...filters,
              tab,
              view: 'queue',
              who: tab === 'mine' ? 'all' : filters.who,
            })
          }
        />
        <ActiveInboxFilters {...filterProps} />
      </div>
      <div className="inbox-queue-order">
        <span>
          {filters.view === 'expired'
            ? `พ้นเวลาตอบ · ${expiredCount.toLocaleString('th-TH')} ห้อง`
            : filters.tab === 'waiting'
              ? 'ใกล้หมดเวลาก่อน'
              : filters.tab === 'mine'
                ? 'แชทที่คุณดูแล'
                : `ทั้งหมด ${(serverCounts?.all ?? sessions.length).toLocaleString('th-TH')} ห้อง`}
        </span>
        {filters.tab === 'waiting' && filters.view !== 'expired' && expiredCount > 0 && (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, view: 'expired' })}
            className="text-warning-strong"
          >
            พ้นเวลาตอบ{' '}
            <span className="font-semibold tabular-nums">
              {expiredCount.toLocaleString('th-TH')}
            </span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
        {filters.view === 'expired' && (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, view: 'queue' })}
            className="text-primary"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            กลับคิว
          </button>
        )}
      </div>
      {filters.view === 'expired' && (
        <p className="border-b border-border bg-warning/5 px-4 py-3 text-xs leading-relaxed text-warning-strong">
          ห้อง Facebook ที่พ้นเวลาตอบหรือยังไม่ทราบเวลา แยกจากคิวรอตอบ
        </p>
      )}

      {/* Room list */}
      <div className="flex-1 overflow-y-auto" aria-busy={isLoading}>
        {/* Keep search and filter controls mounted while only the result region loads or fails. */}
        <QueryBoundary isLoading={false} isError={isError} error={error} onRetry={onRetry}>
        {isLoading ? (
          <div className="space-y-1 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                  <div className="h-2.5 w-36 bg-muted rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
              {allClear ? (
                <CheckCheck className="w-5 h-5 text-success" />
              ) : (
                <MessageCircle className="w-5 h-5 text-muted-foreground/40" />
              )}
            </div>
            {allClear && expiredCount > 0 ? (
              <>
                {/* คิวว่างจริง แต่ยังมีห้องที่พ้น 24 ชม. — "ตอบครบทุกคนแล้ว" จะโกหก */}
                <p className="text-sm font-medium text-foreground leading-snug">คิวว่าง</p>
                <button
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, view: 'expired' })}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  มี {expiredCount.toLocaleString('th-TH')} ห้องที่พ้นเวลาตอบ →
                </button>
              </>
            ) : allClear ? (
              <>
                <p className="text-sm font-medium text-foreground leading-snug">ตอบครบทุกคนแล้ว</p>
                <p className="text-xs text-muted-foreground/80 mt-0.5 leading-snug">
                  ลูกค้าที่ทักมาใหม่จะขึ้นที่นี่
                </p>
              </>
            ) : filters.tab === 'waiting' &&
              filters.view === 'expired' &&
              !listFilterActive &&
              !filters.search ? (
              <>
                <p className="text-sm font-medium text-muted-foreground leading-snug">
                  ไม่มีห้องที่พ้นเวลาตอบ
                </p>
                <button
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, view: 'queue' })}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  กลับคิว
                </button>
              </>
            ) : listFilterActive && !filters.search ? (
              <>
                {/* มีตัวกรองรายการเปิดอยู่ — บอกว่า "ในตัวกรองนี้" ไม่ใช่ "ตอบครบแล้ว" และปุ่มปลดตัวกรองโดยไม่เปลี่ยนแท็บ */}
                <p className="text-sm font-medium text-muted-foreground leading-snug">
                  ไม่มีแชทในตัวกรองนี้
                </p>
                <button
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, channel: null, who: 'all' })}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  ดูทั้งกอง
                </button>
              </>
            ) : filters.search ? (
              <>
                <p className="text-sm font-medium text-muted-foreground leading-snug">
                  ไม่พบผลการค้นหา &ldquo;{filters.search}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    onFiltersChange({ ...filters, search: undefined });
                  }}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  ล้างการค้นหา
                </button>
              </>
            ) : filters.tab === 'mine' ? (
              <>
                <p className="text-sm font-medium text-muted-foreground leading-snug">
                  ยังไม่มีแชทที่คุณดูแล
                </p>
                <button
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, tab: 'all', view: 'queue' })}
                  className="mt-1 min-h-11 text-xs text-primary hover:underline"
                >
                  ดูแชททั้งหมด
                </button>
              </>
            ) : sessions.length === 0 ? (
              <>
                <p className="text-sm font-medium text-muted-foreground leading-snug">
                  ยังไม่มีการสนทนา
                </p>
                <p className="text-xs text-muted-foreground/80 mt-0.5 leading-snug">
                  เมื่อมีลูกค้าทักเข้ามา แชทจะแสดงที่นี่
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-muted-foreground leading-snug">
                  ไม่มีแชทในตัวกรองนี้
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onFiltersChange({
                      ...filters,
                      channel: null,
                      who: 'all',
                      view: 'queue',
                      tab: 'all',
                    });
                  }}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  ดูทั้งหมด
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {visibleRooms.map((session: any) => (
              <div key={session.id} data-room-id={session.id}>
                <ConversationItem
                  session={session}
                  isActive={session.id === activeRoomId}
                  onSelect={onSelectRoom}
                  search={filters.search}
                  onPin={handlePin}
                  aiSettings={aiSettings}
                />
              </div>
            ))}
            {hasMore && (
              <button
                onClick={() => onLoadMore?.()}
                disabled={isLoadingMore}
                className="w-full px-3 py-2.5 text-xs font-medium leading-snug text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> กำลังโหลด…
                  </>
                ) : (
                  'โหลดห้องเพิ่ม'
                )}
              </button>
            )}
          </>
        )}
        </QueryBoundary>
      </div>
    </div>
  );
}

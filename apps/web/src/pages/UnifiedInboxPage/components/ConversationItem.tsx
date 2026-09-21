import { memo, useState } from 'react';
import { CalendarClock, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatChatTimestamp, formatWaitDuration } from '@/lib/chat-time';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, sessionPriorityMap } from '@/lib/status-badges';
import { fbWindowFor, fbWindowLeftText } from './fb-window';
import { apptState, nextAppointment, type RoomAppointment } from './appointment';
import type { ReactNode } from 'react';

/** ป้ายในแถวรายชื่อไม่เกินเท่านี้ — ท่าเดียวกับ OBI (ROW_PILLS=2) หลังเจอแถวสูง 276px จากป้าย 18 ใบ */
const MAX_ROW_PILLS = 2;
import { getGeneratedAvatarUrl } from '@/lib/avatar';

/** Map sentinel-prefixed message bodies to a human-friendly preview. */
function formatMessagePreview(text: string | null | undefined): string {
  if (!text) return '(ข้อความสื่อ)';
  if (text.startsWith('[flex:payment-reminder')) return '📋 แจ้งเตือนค่างวด (Flex Card)';
  if (text.startsWith('[flex:overdue-notice')) return '⚠️ แจ้งค้างชำระ (Flex Card)';
  if (text === '[flex:verify]') return '🔐 ยืนยันตัวตน (Flex Card)';
  if (text.startsWith('[gif:')) return '(GIF)';
  if (text.match(/^\[sticker:\d+:\d+\]$/)) return '(สติกเกอร์)';
  return text;
}

/**
 * AiStatusBadge — surfaces the AI / handoff state of a room in the conversation list.
 *
 * Precedence (most urgent first):
 *  1. handoffMode → "ต้องตอบ" (red) — bot escalated, staff must reply
 *  2. aiPaused    → "พนักงาน"  (amber) — staff took over, AI muted for this room
 *  3. AI eligible → "AI"       (emerald) — auto-mode on AND channel allow-listed
 *  4. otherwise   → null (no badge)
 */
function AiStatusBadge({
  aiAutoEnabled,
  channel,
  enabledChannels,
  aiPaused,
  handoffMode,
}: {
  aiAutoEnabled: boolean;
  channel: string;
  enabledChannels: string[];
  aiPaused: boolean;
  handoffMode: boolean;
}) {
  if (handoffMode) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-snug text-destructive-foreground">
        <span className="size-1.5 rounded-full bg-destructive-foreground" />
        ต้องตอบ
      </span>
    );
  }
  if (aiPaused) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] leading-snug text-warning-strong">
        <span className="size-1.5 rounded-full bg-warning" />
        พนักงาน
      </span>
    );
  }
  const channelAllowed =
    aiAutoEnabled && enabledChannels.length > 0 && enabledChannels.includes(channel);
  if (channelAllowed) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] leading-snug text-success">
        <span className="size-1.5 rounded-full bg-success" />
        AI
      </span>
    );
  }
  return null;
}

interface ConversationItemProps {
  session: {
    id: string;
    channel: string;
    priority: string;
    leadTemperature?: string | null;
    leadScore?: number | null;
    pinnedAt?: string | null;
    unreadCount?: number;
    aiPaused?: boolean;
    handoffMode?: boolean;
    waitingSince?: string | null;
    /** ปิดงานแล้วเมื่อ — แถวจางลง + ป้าย "ปิดแล้ว" อยู่ท้ายรายการ */
    resolvedAt?: string | null;
    /** นัดถัดไปของห้อง (API ส่งใบใกล้สุดที่ยังไม่เสร็จ) — ป้ายนัดตามความใกล้ */
    todos?: RoomAppointment[] | null;
    /** ข้อความล่าสุดของลูกค้า — ฐานนับหน้าต่าง 24 ชม. ของ Facebook */
    lastCustomerAt?: string | null;
    customer?: { id: string; name: string; phone?: string; avatarUrl?: string | null; lineAvatarUrl?: string | null } | null;
    assignedTo?: { id: string; name: string; avatarUrl?: string | null } | null;
    tags?: { tag: string }[];
    messages?: { text?: string | null; role: string; createdAt: string }[];
    lastMessageAt: string;
    totalMessages: number;
    lineUserId?: string;
    displayName?: string | null;
    pictureUrl?: string | null;
  };
  isActive: boolean;
  onSelect: (roomId: string) => void;
  onPin?: (roomId: string, isPinned: boolean) => void;
  aiSettings?: { autoModeEnabled: boolean; enabledChannels: string[] };
}

const CHANNEL_CONFIG: Record<string, { bg: string; label: string; text: string }> = {
  LINE_FINANCE: { bg: 'bg-[#06C755]', label: 'L', text: 'LINE' },
  LINE_SHOP: { bg: 'bg-[#06C755]', label: 'L', text: 'LINE' },
  FACEBOOK: { bg: 'bg-[#1877F2]', label: 'f', text: 'FB' },
  TIKTOK: { bg: 'bg-foreground', label: '♪', text: 'TT' },
  WEB: { bg: 'bg-muted-foreground', label: 'W', text: 'Web' },
};

function Avatar({ session, displayName }: { session: ConversationItemProps['session']; displayName: string }) {
  const [imgError, setImgError] = useState(false);
  const avatarUrl =
    session.customer?.avatarUrl ||
    session.customer?.lineAvatarUrl ||
    session.pictureUrl ||
    getGeneratedAvatarUrl(session.id);
  const channelCfg = CHANNEL_CONFIG[session.channel] ?? { bg: 'bg-muted-foreground', label: '?' };

  return (
    <div className="relative flex-shrink-0">
      {avatarUrl && !imgError ? (
        <img
          src={avatarUrl}
          alt={session.customer?.name ?? ''}
          className="w-10 h-10 rounded-full object-cover ring-2 ring-background"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold ring-2 ring-background',
            channelCfg.bg,
          )}
        >
          {displayName[0]}
        </div>
      )}
      {/* Channel dot */}
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-[2px] border-card',
          'flex items-center justify-center text-white text-[7px] font-extrabold',
          channelCfg.bg,
        )}
      >
        {channelCfg.label}
      </span>
    </div>
  );
}

function ConversationItem({ session, isActive, onSelect, onPin, aiSettings }: ConversationItemProps) {
  const lastMessage = session.messages?.[0];
  const displayName =
    session.customer?.name ??
    session.displayName ??
    session.lineUserId?.slice(0, 12) ??
    'ไม่ทราบชื่อ';
  const isPinned = session.pinnedAt != null;
  const unreadCount = session.unreadCount ?? 0;
  const hasUnread = unreadCount > 0;
  const aiAutoEnabled = aiSettings?.autoModeEnabled ?? false;
  const enabledChannels = aiSettings?.enabledChannels ?? [];
  const aiPaused = session.aiPaused ?? false;
  const handoffMode = session.handoffMode ?? false;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={isActive || undefined}
      className={cn(
        'relative group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors duration-100 border-b border-border/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
        isActive
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-muted/40',
        isPinned && !isActive && 'bg-warning/5',
        !!session.resolvedAt && !isActive && 'opacity-60',
      )}
      onClick={() => onSelect(session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(session.id);
        }
      }}
    >
      <Avatar session={session} displayName={displayName} />

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {isPinned && <Pin className="w-2.5 h-2.5 text-warning-strong flex-shrink-0 fill-warning" />}
            <span className={cn(
              'text-sm truncate',
              hasUnread ? 'font-bold text-foreground' : 'font-medium text-foreground/80',
            )}>
              {displayName}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground flex-shrink-0 tabular-nums">
            {formatChatTimestamp(session.lastMessageAt)}
          </span>
        </div>

        {/* Last message preview */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={cn(
            'text-[13px] truncate',
            hasUnread ? 'text-foreground/90' : 'text-muted-foreground',
          )}>
            {lastMessage?.role === 'STAFF' && <span className="text-primary font-medium">คุณ: </span>}
            {lastMessage?.role === 'BOT' && <span className="text-muted-foreground font-medium">Bot: </span>}
            {lastMessage ? formatMessagePreview(lastMessage.text) : <span className="italic text-muted-foreground/70">ยังไม่มีข้อความ</span>}
          </p>
          {hasUnread && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-snug flex-shrink-0">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>

        {/* Tags + priority + assigned + AI status */}
        {(session.resolvedAt ||
          session.todos?.length ||
          session.waitingSince ||
          session.tags?.length ||
          (session.priority && session.priority !== 'NORMAL' && session.priority !== 'LOW') ||
          session.assignedTo ||
          aiPaused ||
          handoffMode ||
          (aiAutoEnabled && enabledChannels.includes(session.channel))) && (
          <div className="flex items-center gap-1.5 mt-1.5 overflow-hidden whitespace-nowrap">
            {/* ป้ายไม่เกิน 2 ใบ ที่เหลือยุบเป็น +N (สเปก §7 แก้ไข 2026-09-05) — ลำดับล็อกไว้:
                ป้ายหน้าต่าง (เหลือ N / หมดเวลาตอบ / รอ N) → ด่วน → ค้างชำระ → สถานะบอท
                ป้ายหน้าต่างมาก่อนเสมอ เพราะเป็นใบเดียวที่แปลว่า "ทำงานต่อไม่ได้" · ของเดิมห้าใบเต็ม 235/235px แบบ nowrap */}
            {(() => {
              const pills: ReactNode[] = [];
              if (session.resolvedAt) {
                pills.push(<Badge key="closed" variant="secondary" appearance="light" className="text-[10px] px-1.5 py-0 h-5 leading-snug text-muted-foreground">ปิดแล้ว</Badge>);
              }
              if (session.waitingSince) {
                const w = fbWindowFor(session);
                if (session.channel === 'FACEBOOK' && !session.lastCustomerAt) {
                  // ยังไม่มีค่า (ก่อน CLI เติม) — เซิร์ฟเวอร์จัดห้องนี้ไว้ใน "ตอบไม่ทัน" ป้ายห้ามพูด "รอ N" สวนกับกองที่มันอยู่
                  pills.push(<Badge key="win" variant="secondary" appearance="light" className="text-[10px] px-1.5 py-0 h-5 leading-snug text-muted-foreground">ไม่ทราบเวลา</Badge>);
                } else if (w === 'closed') {
                  pills.push(<Badge key="win" variant="secondary" appearance="light" className="text-[10px] px-1.5 py-0 h-5 leading-snug text-muted-foreground">หมดเวลาตอบ</Badge>);
                } else if (w === 'closing') {
                  pills.push(<Badge key="win" variant="warning" appearance="light" className="text-[10px] px-1.5 py-0 h-5 leading-snug">เหลือ {fbWindowLeftText(session.lastCustomerAt)}</Badge>);
                } else {
                  pills.push(<Badge key="win" variant="destructive" appearance="light" className="text-[10px] px-1.5 py-0 h-5 leading-snug">รอ {formatWaitDuration(session.waitingSince)}</Badge>);
                }
              }
              const appt = apptState(nextAppointment(session.todos)?.dueDate);
              if (appt) {
                pills.push(
                  <Badge key="appt" variant={appt.tone === 'danger' ? 'destructive' : appt.tone === 'warn' ? 'warning' : 'secondary'} appearance="light" className="text-[10px] px-1.5 py-0 h-5 leading-snug inline-flex items-center gap-1">
                    <CalendarClock className="size-3" />{appt.label}
                  </Badge>,
                );
              }
              if (session.priority && session.priority !== 'NORMAL' && session.priority !== 'LOW') {
                const cfg = getStatusBadgeProps(session.priority, sessionPriorityMap);
                // แผนที่กลางยังเป็น "HIGH"/"CRITICAL" — ในแถวรายชื่อพูดไทยเหมือนป้ายใบอื่น
                const label = session.priority === 'CRITICAL' ? 'ด่วนมาก' : session.priority === 'HIGH' ? 'ด่วน' : cfg.label;
                pills.push(<Badge key="pri" variant={cfg.variant} appearance={cfg.appearance} className="text-[10px] px-1.5 py-0 h-5">{label}</Badge>);
              }
              if (session.tags?.some((t: { tag: string }) => t.tag === 'overdue')) {
                pills.push(<Badge key="tag" variant="destructive" appearance="light" className="text-[10px] px-1.5 py-0 h-5">ค้างชำระ</Badge>);
              }
              const ai = (
                <AiStatusBadge
                  key="ai"
                  aiAutoEnabled={aiAutoEnabled}
                  channel={session.channel}
                  enabledChannels={enabledChannels}
                  aiPaused={aiPaused}
                  handoffMode={handoffMode}
                />
              );
              if (aiPaused || handoffMode || (aiAutoEnabled && enabledChannels.includes(session.channel))) pills.push(ai);
              const shown = pills.slice(0, MAX_ROW_PILLS);
              const hidden = pills.length - shown.length;
              return (
                <>
                  {shown}
                  {hidden > 0 && (
                    <span className="inline-flex h-5 items-center rounded-full border border-border/60 px-1.5 text-[10px] leading-none text-muted-foreground tabular-nums" title={`อีก ${hidden} ป้าย`}>
                      +{hidden}
                    </span>
                  )}
                </>
              );
            })()}
            {session.assignedTo && (
              <span className="text-[11px] text-muted-foreground/80 ml-auto truncate max-w-[80px]">
                {session.assignedTo.name}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Hover pin button */}
      {onPin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin(session.id, isPinned);
          }}
          className={cn(
            'absolute right-2 top-2 p-1 min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-all',
            isPinned
              ? 'text-warning-strong opacity-100'
              : 'text-muted-foreground opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 hover:text-warning-strong hover:bg-muted',
          )}
          title={isPinned ? 'ถอดหมุด' : 'ปักหมุด'}
          aria-label={isPinned ? 'ถอดหมุด' : 'ปักหมุด'}
        >
          <Pin className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default memo(ConversationItem);

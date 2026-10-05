import NoteMentionInput, { type NoteDraft } from './NoteMentionInput';
import { ChatMediaPicker } from './ChatMediaPicker';
import { useChatMediaPicker } from '../hooks/useChatMediaPicker';
import { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';

import { Send, MoreVertical, ArrowLeft, Paperclip, Pin, MessageSquare, UserCircle2, MessageSquareQuote, Loader2, Upload, Eye, Bell, BellOff, Bot, BotOff, AlertCircle, RotateCw, Smartphone, Clock, StickyNote, Lock, Check, CalendarClock } from 'lucide-react';
import { isSameDay } from 'date-fns';
import { formatDateSeparator, formatChatTimestamp, formatWaitDuration } from '@/lib/chat-time';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import MessageBubble from './MessageBubble';
import { swapRoomDraft } from './composer-draft';
import PrepareOfferDialog from './PrepareOfferDialog';
import SessionActions from './SessionActions';
import MessageTemplatePicker from './MessageTemplatePicker';
import ProductPickerDialog from './ProductPickerDialog';
import AiSuggestPanel from './AiSuggestPanel';
import NoteBubble from './NoteBubble';
import PinnedNoteBar from './PinnedNoteBar';
import { mergeTimeline, type RoomNote } from './timeline';
import { apptState, nextAppointment } from './appointment';
import { fbWindowFor, fbWindowLeftText } from './fb-window';
import { useKeyboardShortcuts, isEditableTarget } from '../hooks/useKeyboardShortcuts';
import api from '@/lib/api';
import { getGeneratedAvatarUrl } from '@/lib/avatar';

import { isAcceptedFile } from './upload-accept';

const MAX_COMPOSER_HEIGHT = 128; // px — matches Tailwind max-h-32 (8rem)

interface ChatPanelProps {
  onCreditMessage?: (messageId: string) => void;
  creditMessageIds?: string[];
  creditBusy?: boolean;
  onGfinMessage?: (messageId: string) => void;
  gfinMessageIds?: string[];
  gfinBusy?: boolean;
  session: any;
  messages: any[];
  isLoadingMessages: boolean;
  isCustomerTyping?: boolean;
  // Returns false when the send was rejected so the composer can keep the typed
  // text; sticker/GIF callers ignore the result.
  onSendMessage: (text: string) => void | Promise<boolean | void>;
  onSendFile?: (file: File) => void;
  onSendSticker?: (params: { packageId: number; stickerId: number }) => void;
  onBack: () => void;
  onAssign: (staffId: string) => void;
  onTransfer: (staffId: string) => void;
  onResolve: () => void;
  onReopen?: () => void;
  reopenPending?: boolean;
  onReturnToAI: () => void;
  currentUserId: string;
  onShowCustomerInfo?: () => void;
  isUploadingFile?: boolean;
  otherViewers?: { userId: string; userName: string }[];
  roomMuted?: boolean;
  onToggleRoomMute?: () => void;
  aiPaused?: boolean;
  onToggleAi?: () => void;
  aiTogglePending?: boolean;
  // Optimistic-send ghosts keyed by clientMessageId — each resolves when its saved row lands.
  pendingSends?: { clientMessageId: string; text: string }[];
  failedSends?: { id: string; text: string; source?: 'http' | 'ws'; reason?: string }[];
  onRetrySend?: (id: string, text: string) => void;
  onStartTyping?: () => void;
  onStopTyping?: () => void;
  staffTypingName?: string | null;
  /** โน้ตภายในของห้อง — รวมเข้าไทม์ไลน์ (สเปกแผงกลาง 2026-09-06) */
  notes?: RoomNote[];
  /** โน้ตปักหมุด (ห้องละ 1) — แถบใต้หัวห้อง */
  pinnedNote?: RoomNote | null;
  currentUserRole?: string;
  onAddNote?: (draft: NoteDraft) => void | Promise<boolean | void>;
  onPinNote?: (noteId: string) => void;
  onUnpinNote?: (noteId: string) => void;
  onDeleteNote?: (noteId: string) => void;
}

export default function ChatPanel({
  onCreditMessage,
  creditMessageIds = [],
  creditBusy,
  onGfinMessage,
  gfinMessageIds = [],
  gfinBusy,
  session,
  messages,
  isLoadingMessages,
  isCustomerTyping = false,
  onSendMessage,
  notes = [],
  pinnedNote = null,
  currentUserRole,
  onAddNote,
  onPinNote,
  onUnpinNote,
  onDeleteNote,
  onSendFile,
  onSendSticker,
  onBack,
  onAssign,
  onTransfer,
  onResolve,
  onReopen,
  reopenPending,
  onReturnToAI,
  currentUserId,
  onShowCustomerInfo,
  isUploadingFile = false,
  otherViewers,
  roomMuted,
  onToggleRoomMute,
  aiPaused,
  onToggleAi,
  aiTogglePending,
  pendingSends,
  failedSends,
  onRetrySend,
  onStartTyping,
  onStopTyping,
  staffTypingName,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  // โหมดช่องพิมพ์ (ท่า OBI): คุยกับลูกค้า | โน้ตภายใน — เปลี่ยนห้องแล้วกลับโหมดคุยเสมอ กันเผลอ
  const [composerMode, setComposerMode] = useState<'chat' | 'note'>('chat');
  const isNoteMode = composerMode === 'note';
  useEffect(() => {
    setComposerMode('chat');
  }, [session?.id]);
  const timeline = useMemo(() => mergeTimeline(messages, notes), [messages, notes]);
  const canDeleteNote = (n: RoomNote) =>
    (n.staff?.id ?? n.staffId) === currentUserId || currentUserRole === 'OWNER' || currentUserRole === 'BRANCH_MANAGER';
  const [isSending, setIsSending] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<{ aiDraft: string; intent: string } | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const mediaPicker = useChatMediaPicker();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const noteContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());
  const prevRoomRef = useRef<string | undefined>(undefined);
  const inputTextRef = useRef(inputText);
  inputTextRef.current = inputText; // keep the live value for the [roomId]-only effect

  // ─── Staff-typing emit helpers ────────────────────────────────────────────────
  const typingActiveRef = useRef(false);
  const stopTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitTyping = () => {
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      onStartTyping?.();
    }
    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
    stopTypingTimerRef.current = setTimeout(() => {
      typingActiveRef.current = false;
      onStopTyping?.();
    }, 3000);
  };
  const endTyping = () => {
    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      onStopTyping?.();
    }
  };
  useEffect(() => () => {
    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
  }, []);

  const queryClient = useQueryClient();
  const pinMutation = useMutation({
    mutationFn: (isPinned: boolean) =>
      isPinned
        ? api.delete(`/staff-chat/rooms/${session.id}/pin`)
        : api.post(`/staff-chat/rooms/${session.id}/pin`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      toast.success(session.pinnedAt ? 'ถอดหมุดแล้ว' : 'ปักหมุดแล้ว');
    },
  });

  // Keyboard shortcuts
  const shortcutActions = useMemo(
    () => ({
      onOpenPalette: () => setShowTemplatePicker(true),
      onResolve,
      onEscape: () => setShowTemplatePicker(false),
    }),
    [onResolve],
  );
  useKeyboardShortcuts(shortcutActions);

  const isLineChannel = session?.channel?.startsWith('LINE');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSendFile) {
      onSendFile(file);
    }
    e.target.value = ''; // reset
  };

  // ─── Paste handler (images only — text paste falls through unchanged) ─────────
  const handlePaste = (e: React.ClipboardEvent) => {
    if (!onSendFile) return;
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imageFiles.length === 0) return; // let normal text paste through — do NOT preventDefault
    e.preventDefault();
    imageFiles.forEach((f) => onSendFile(f));
  };

  // ─── Drag-and-drop ────────────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    if (!onSendFile || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!onSendFile) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const accepted = files.filter(isAcceptedFile);
    if (accepted.length < files.length) {
      toast.error('บางไฟล์ส่งไม่ได้ (รองรับรูปภาพ, PDF, DOC)');
    }
    accepted.forEach((f) => onSendFile(f));
  };

  const insertEmoji = (emoji: string) => {
    const textarea = inputRef.current;
    if (textarea) {
      const start = textarea.selectionStart ?? inputText.length;
      const end = textarea.selectionEnd ?? inputText.length;
      const newText = inputText.slice(0, start) + emoji + inputText.slice(end);
      setInputText(newText);
      // Restore cursor after emoji
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
        textarea.focus();
      });
    } else {
      setInputText((prev) => prev + emoji);
    }
    setEmojiOpen(false);
  };

  const handleStickerClick = (packageId: number, stickerId: number) => {
    endTyping();
    if (onSendSticker) {
      onSendSticker({ packageId, stickerId });
    } else {
      onSendMessage(`[sticker:${packageId}:${stickerId}]`);
    }
    setEmojiOpen(false);
  };

  // Scroll behavior:
  //  • Opening a room → ALWAYS jump (instant) to the latest message.
  //  • A new message in the room already open → only follow if the user is near
  //    the bottom, so we don't yank them away while they read older history.
  const roomId = session?.id as string | undefined;
  const scrolledRoomRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const anchor = messagesEndRef.current;
    if (!anchor || messages.length === 0) return;
    if (scrolledRoomRef.current !== roomId) {
      scrolledRoomRef.current = roomId;
      anchor.scrollIntoView({ behavior: 'auto' }); // jump to latest on room open
      return;
    }
    const container = anchor.parentElement;
    if (container) {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom > 150) return;
    }
    anchor.scrollIntoView({ behavior: 'smooth' });
    // pending/failed counts included so just-sent (or just-failed) ghosts —
    // rendered below the saved messages — scroll into view immediately.
  }, [messages.length, roomId, pendingSends?.length, failedSends?.length]);

  // Auto-grow the textarea to fit its content (capped). Runs on every inputText
  // change — typing, send-clear, draft load (Task 2), emoji/template insert —
  // so all sizing flows through one place. useLayoutEffect avoids a height flash.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [inputText]);

  // On room change: persist the room you left, restore the room you entered,
  // drop the AI-suggestion association (it's room-scoped — see below), and focus
  // the box on desktop. Keyed on roomId ONLY so streaming messages never reload
  // the draft or steal focus mid-typing.
  // NOTE: a room switch transiently passes roomId=undefined (session refetch has no
  // keepPreviousData), so this runs A→undefined→B. Draft correctness relies on
  // swapRoomDraft saving ONLY when prevRoom is truthy (undefined bounce = no save).
  useEffect(() => {
    const incoming = swapRoomDraft(draftsRef.current, prevRoomRef.current, roomId, inputTextRef.current);
    prevRoomRef.current = roomId;
    setInputText(incoming);
    // selectedSuggestion is metadata for THIS room's AI draft; carrying it into
    // another room would mislabel that room's send as an edit of this draft.
    setSelectedSuggestion(null);
    // Desktop only — on mobile, focus() pops the keyboard over the history.
    if (roomId && typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches) {
      inputRef.current?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- room-change only; inputText read via inputTextRef
  }, [roomId]);

  // Screen-reader announcements: new inbound message + send failure.
  const [liveMsg, setLiveMsg] = useState('');
  const announcedRef = useRef<{ roomId: string | null; lastId: string | null }>({
    roomId: null,
    lastId: null,
  });
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    // Ignore a stale array still holding the previous room's messages.
    if (last?.roomId && roomId && last.roomId !== roomId) return;
    const a = announcedRef.current;
    if (a.roomId !== roomId) {
      // First sight of this room's messages — adopt the last as seen, no announce.
      announcedRef.current = { roomId: roomId ?? null, lastId: last?.id ?? null };
      return;
    }
    if (last?.role === 'CUSTOMER' && last?.id && last.id !== a.lastId) {
      announcedRef.current = { roomId: roomId ?? null, lastId: last.id };
      const text = (last.text ?? '').trim();
      setLiveMsg(text ? `ข้อความใหม่: ${text.slice(0, 60)}` : 'ข้อความใหม่จากลูกค้า');
    }
  }, [messages, roomId]);

  // "g" → jump the open thread to the latest message (vim-style). Guarded so it
  // never fires while typing in the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key !== 'g' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!roomId) return;
      e.preventDefault();
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [roomId]);

  const getLastCustomerMessage = () => {
    const customerMsgs = messages.filter((m: any) => m.role === 'CUSTOMER');
    return customerMsgs[customerMsgs.length - 1]?.text ?? customerMsgs[customerMsgs.length - 1]?.content ?? '';
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending || isNoteMode) return;
    // Clear the composer immediately — the in-flight ghost shows the text while
    // sending, and a FAILED ghost (with retry) owns it if the send fails. The
    // Batch-1 keep-text-in-composer path is replaced by that ghost.
    setInputText('');
    endTyping();
    if (roomId) draftsRef.current.delete(roomId);
    const suggestion = selectedSuggestion;
    setSelectedSuggestion(null);
    setIsSending(true);
    let result: boolean | void;
    try {
      result = await onSendMessage(text);
    } finally {
      setIsSending(false);
    }
    if (result === true && suggestion) {
      const type = text === suggestion.aiDraft ? 'ACCEPT' : 'EDIT';
      api
        .post('/staff-chat/ai/training-feedback', {
          roomId: session.id,
          type,
          customerMessage: getLastCustomerMessage(),
          aiDraft: suggestion.aiDraft,
          humanEdit: type === 'EDIT' ? text : undefined,
          intent: suggestion.intent,
        })
        .catch(() => {});
    }
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Never send while an IME composition is in progress — Thai/CJK candidate
    // selection commits with Enter, which would otherwise send mid-word.
    if (e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229) {
      return;
    }
    if (e.key === 'Escape' && isNoteMode) {
      e.preventDefault();
      setComposerMode('chat');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const lastMessageAt =
    messages.length > 0
      ? new Date(messages[messages.length - 1]?.createdAt ?? 0).getTime()
      : 0;

  const handleSelectSuggestion = (text: string, metadata: { aiDraft: string; intent: string }) => {
    setInputText(text);
    setSelectedSuggestion(metadata);
    inputRef.current?.focus();
  };

  const insertAtCaret = (content: string) => {
    const textarea = inputRef.current;
    if (textarea) {
      const start = textarea.selectionStart ?? inputText.length;
      const end = textarea.selectionEnd ?? inputText.length;
      setInputText(inputText.slice(0, start) + content + inputText.slice(end));
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + content.length;
        textarea.focus();
      });
    } else {
      setInputText((prev) => prev + (prev ? '\n' : '') + content);
    }
  };

  if (!session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
        <div className="relative mb-5">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-primary/40" />
          </div>
          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-primary/60 animate-pulse" />
          </div>
        </div>
        <p className="text-sm font-semibold text-foreground/80 leading-snug">เลือกการสนทนา</p>
        <p className="text-xs text-muted-foreground mt-1.5 max-w-[200px] leading-relaxed">
          เลือกแชทจากรายการด้านซ้ายเพื่อเริ่มตอบลูกค้า
        </p>
      </div>
    );
  }

  const displayName =
    session.customer?.name ??
    session.displayName ??
    session.lineUserId?.slice(0, 12) ??
    'ไม่ทราบชื่อ';
  const avatarUrl =
    session.customer?.avatarUrl ||
    session.customer?.lineAvatarUrl ||
    session.pictureUrl ||
    getGeneratedAvatarUrl(session.id);
  // Backend truth: resolve() sets status=IDLE + resolvedAt; an inbound customer
  // message auto-reopens the room to ACTIVE (room-manager), so a resolved room
  // can never trap an ongoing conversation behind this gate.
  const isResolved = !!session.resolvedAt || session.status === 'IDLE';
  const isLine = session.channel === 'LINE_FINANCE' || session.channel === 'LINE_SHOP';
  const channelLabel =
    session.channel === 'LINE_FINANCE' ? 'LINE การเงิน'
      : session.channel === 'LINE_SHOP' ? 'LINE ร้าน'
        : session.channel === 'FACEBOOK' ? 'Facebook'
          : session.channel === 'TIKTOK' ? 'TikTok'
            : 'Web';
  const channelDotClass = isLine ? 'bg-[#06C755]' : session.channel === 'FACEBOOK' ? 'bg-[#1877F2]' : 'bg-foreground/60';
  const roomAppt = nextAppointment(session.todos);
  const roomApptState = apptState(roomAppt?.dueDate);
  const assigneeFullName: string | null = session.assignedTo?.name ?? session.assignedStaff?.name ?? null;
  // ชิปใช้ชื่อต้นอย่างเดียว (ชื่อเต็มอยู่ใน title) — บรรทัดสถานะแคบ ชื่อ-นามสกุลไทยยาวจะชนปุ่มขวา
  const assigneeName = assigneeFullName ? assigneeFullName.trim().split(/\s+/)[0] : null;
  // บรรทัดสถานะหัวห้อง: รอตอบ (เหลือง · แดงเมื่อเกิน 1 ชม.) · ตอบแล้ว · ปิดงานแล้ว
  const roomStatus = (() => {
    if (isResolved) {
      const when = session.resolvedAt ? formatChatTimestamp(session.resolvedAt) : '';
      return { tone: 'text-muted-foreground', text: when ? `ปิดงานแล้ว · ${when}` : 'ปิดงานแล้ว' };
    }
    if (session.waitingSince) {
      const late = Date.now() - new Date(session.waitingSince).getTime() > 60 * 60_000;
      return { tone: late ? 'text-destructive' : 'text-amber-700 dark:text-amber-300', text: `รอตอบ ${formatWaitDuration(session.waitingSince)}` };
    }
    return { tone: 'text-primary', text: 'ตอบแล้ว' };
  })();
  // ช่องทางอื่นไม่มีหน้าต่าง → 'open' เสมอ · ห้อง FB ที่ยังไม่มี lastCustomerAt → 'open' (ไม่ขู่ รอเหตุจริงจากการส่ง)
  const fbWindow = fbWindowFor(session);

  return (
    <div
      className="@container relative flex-1 flex min-h-0 min-w-0 flex-col h-full"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drop overlay — pointer-events-none so it never blocks the composer */}
      {isDragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/5 pointer-events-none">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary bg-card/90 px-6 py-4 text-primary">
            <Upload className="size-6" />
            <span className="text-sm font-medium leading-snug">วางที่นี่ = ส่งให้ลูกค้า</span>
            <span className="text-xs leading-snug">ลูกค้าเห็นทันที</span>
          </div>
        </div>
      )}
      {/* Header — ชื่อ · รอตอบนานแค่ไหน · ใครดูแล · ปุ่มที่รู้ว่าทำอะไร (แบบที่เจ้าของโอเค 2026-09-06) */}
      <div className="flex shrink-0 flex-wrap @md:flex-nowrap items-center gap-2 @lg:gap-3 px-2.5 @lg:px-3.5 py-2 border-b border-border/60 bg-card">
          <button onClick={onBack} aria-label="กลับ" className="lg:hidden p-1 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center overflow-hidden ring-2 ring-background">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-muted-foreground text-sm font-bold">{displayName[0]}</span>
            )}
          </div>
          {/* จุดสีช่องทางที่มุมรูป (ฟ้า = Facebook · เขียว = LINE) แทนเม็ดยาเต็มใบ */}
          <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-card', channelDotClass)} />
        </div>
        <div className="min-w-0 flex-1 basis-32 @md:basis-0">
          <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground" title={displayName}>{displayName}</h3>
          <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12px] text-muted-foreground [&>*]:shrink-0">
            <span>{channelLabel}</span>
            <span className="text-border">·</span>
            {/* สถานะจริงจาก waiting_since (PR1) แทน "กำลังสนทนา" ที่ไม่บอกอะไร */}
            <span className={cn('inline-flex items-center gap-1 font-semibold', roomStatus.tone)} data-testid="room-status">
              <span className="size-[7px] rounded-full bg-current" />
              {roomStatus.text}
            </span>
            {/* ชิปผู้ดูแล — ที่เดียวที่เห็นว่าใครรับห้อง (แผงขวาไม่มีกล่องผู้ดูแลแล้ว) · กด = เปิดมอบหมาย */}
            {!isResolved && (
              <span className="hidden @md:inline-flex items-center gap-1.5">
                <span className="text-border">·</span>
                <button
                  type="button"
                  onClick={() => setShowActions((v) => !v)}
                  aria-expanded={showActions}
                  title={assigneeFullName ? `ผู้ดูแล: ${assigneeFullName} — กดเพื่อมอบหมาย/โอน` : 'ตอบก่อนได้เป็นเจ้าของห้อง — กดเพื่อมอบหมาย'}
                  className={cn(
                    'inline-flex h-5 max-w-[11rem] items-center gap-1 truncate rounded-full border text-[11.5px] leading-none transition-colors',
                    assigneeName
                      ? 'border-border bg-card pl-0.5 pr-2 text-foreground hover:bg-muted'
                      : 'border-dashed border-warning/60 bg-warning/10 px-2 text-amber-800 hover:bg-warning/20 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20',
                  )}
                >
                  {assigneeName ? (
                    <>
                      <span className="grid size-4 place-items-center rounded-full bg-sky-500 text-[9px] font-bold text-white dark:bg-sky-400 dark:text-sky-950">{assigneeName[0]}</span>
                      {assigneeName} ดูแล
                    </>
                  ) : (
                    'ยังไม่มีผู้ดูแล'
                  )}
                </button>
              </span>
            )}
            {/* ชิปนัดถัดไป — กดแล้วเลื่อนไปที่นัดในแผงขวา (จอแคบเปิดแผงให้) */}
            {roomAppt && roomApptState && (
              <span className="hidden @md:inline-flex items-center gap-1.5">
                <span className="text-border">·</span>
                <button
                  type="button"
                  title={`${roomAppt.title} — กดเพื่อดูนัดในแผงขวา`}
                  onClick={() => {
                    if (window.innerWidth < 1280) onShowCustomerInfo?.();
                    document.getElementById('room-appointments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={cn(
                    'inline-flex h-5 max-w-[11rem] items-center gap-1 truncate rounded-full border px-2 text-[11.5px] font-semibold leading-none transition-colors',
                    roomApptState.tone === 'danger'
                      ? 'border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20'
                      : roomApptState.tone === 'warn'
                        ? 'border-warning/60 bg-warning/10 text-amber-800 hover:bg-warning/20 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-200'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted',
                  )}
                >
                  <CalendarClock className="size-3" />
                  {roomApptState.label}
                </button>
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1 @lg:gap-1.5 shrink-0">
          {onShowCustomerInfo && (
            <button
              onClick={onShowCustomerInfo}
              className="xl:hidden size-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground/70 hover:bg-accent rounded-lg"
              title="ข้อมูลลูกค้า"
              aria-label="ข้อมูลลูกค้า"
            >
              <UserCircle2 className="w-5 h-5" />
            </button>
          )}
          {/* รางสถานะ 3 ปุ่ม: หมุด · บอท · แจ้งเตือน — อันที่ "เปิด" นูนขึ้นเป็นสีขาว */}
          <div className="flex gap-px rounded-lg border border-border bg-muted p-0.5" role="group" aria-label="สถานะห้อง">
            <button
              type="button"
              onClick={() => pinMutation.mutate(!!session.pinnedAt)}
              disabled={pinMutation.isPending}
              className={cn(
                'size-7 @lg:size-8 inline-flex items-center justify-center rounded-md transition-colors',
                session.pinnedAt ? 'bg-card text-warning-strong shadow-sm dark:bg-white/10 dark:text-amber-300' : 'text-muted-foreground hover:text-foreground',
              )}
              title={session.pinnedAt ? 'ปักหมุดอยู่ — กดเพื่อถอด' : 'ปักหมุดห้องนี้ไว้บนสุด'}
              aria-label={session.pinnedAt ? 'ถอดหมุดห้องแชท' : 'ปักหมุดห้องแชท'}
              aria-pressed={!!session.pinnedAt}
            >
              {session.pinnedAt ? <Pin className="size-4" /> : <Pin className="size-4" />}
            </button>
            {onToggleAi && (
              <button
                type="button"
                onClick={onToggleAi}
                disabled={aiTogglePending}
                title={aiPaused ? 'บอทหยุดตอบ (พนักงานตอบเอง) — กดเพื่อคืนให้บอท' : 'บอทตอบอัตโนมัติอยู่ — กดเพื่อหยุดและตอบเอง'}
                aria-label="สลับสถานะ AI"
                aria-pressed={!aiPaused}
                className={cn(
                  'size-7 @lg:size-8 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50',
                  aiPaused ? 'text-muted-foreground hover:text-foreground' : 'bg-card text-primary shadow-sm dark:bg-white/10',
                )}
              >
                {aiPaused ? <BotOff className="size-4" /> : <Bot className="size-4" />}
              </button>
            )}
            {onToggleRoomMute && (
              <button
                type="button"
                onClick={onToggleRoomMute}
                title={roomMuted ? 'ปิดเสียงห้องนี้อยู่ — กดเพื่อเปิด' : 'แจ้งเตือนเปิดอยู่ — กดเพื่อปิดเสียงห้องนี้'}
                aria-label="สลับการแจ้งเตือนห้องนี้"
                aria-pressed={!!roomMuted}
                className={cn(
                  'size-7 @lg:size-8 inline-flex items-center justify-center rounded-md transition-colors',
                  roomMuted ? 'bg-card text-destructive shadow-sm dark:bg-white/10 dark:text-red-300' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {roomMuted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
              </button>
            )}
          </div>
          {/* ปิดงาน = ปุ่มหลักมีคำ (เดิมซ่อนใน ⋮) · ห้องที่ปิดแล้วปุ่มเดิมกลายเป็น "เปิดงานกลับ" */}
          {isResolved ? (
            onReopen && (
              <button
                type="button"
                onClick={onReopen}
                disabled={reopenPending}
                title="เปิดงานกลับ"
                aria-label="เปิดงานกลับ"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2 @lg:px-3 text-[12.5px] font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                {reopenPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                <span className="hidden @lg:inline">เปิดงานกลับ</span>
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={onResolve}
              title="ปิดงาน — จบเรื่องนี้ ลูกค้าทักใหม่ห้องกลับมาเอง"
              aria-label="ปิดงาน"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2 @lg:px-3 text-[12.5px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Check className="size-4" />
              <span className="hidden @lg:inline">ปิดงาน</span>
            </button>
          )}
          <button
            onClick={() => setShowActions(!showActions)}
            aria-label="ตัวเลือกเพิ่มเติม"
            aria-expanded={showActions}
            title="เพิ่มเติม: มอบหมาย · โอนห้อง · คืนให้บอท"
            className="size-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground/70 hover:bg-accent rounded-lg"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Actions dropdown */}
      {showActions && (
        <SessionActions
          session={session}
          onAssign={onAssign}
          onTransfer={onTransfer}
          onResolve={onResolve}
          onReturnToAI={onReturnToAI}
          onClose={() => setShowActions(false)}
          currentUserId={currentUserId}
        />
      )}

      {/* Persistent "another staff is viewing" banner */}
      {otherViewers && otherViewers.length > 0 && (
        <div className="flex items-center gap-2 bg-warning/10 px-4 py-1.5 text-[11px] text-warning-strong dark:bg-amber-400/10 dark:text-amber-200 leading-snug border-b border-warning/20">
          <Eye className="size-3.5 shrink-0" />
          <span className="truncate">
            {otherViewers.map((v) => v.userName).join(', ')} กำลังดูห้องนี้อยู่ — ระวังตอบซ้ำ
          </span>
        </div>
      )}

      {/* Screen-reader live regions — siblings of the log, not nested inside it */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{liveMsg}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {(failedSends ?? []).length > 0 ? 'ส่งข้อความไม่สำเร็จ' : ''}
      </div>

      {/* Messages */}
      {pinnedNote && onUnpinNote && <PinnedNoteBar note={pinnedNote} onUnpin={onUnpinNote} />}
      <div className="flex-1 overflow-y-auto px-4 py-3" role="log" aria-label="ประวัติข้อความ">
        {isLoadingMessages ? (
          <div className="space-y-3 py-4">
            <span className="sr-only">กำลังโหลดข้อความ</span>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} aria-hidden className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'animate-pulse rounded-2xl bg-muted',
                    i % 2 ? 'h-9 w-44 rounded-br-md' : 'h-12 w-56 rounded-bl-md',
                  )}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            {timeline.map((item, i) => {
              const prev = timeline[i - 1];
              const showDateSeparator =
                i === 0 || !isSameDay(new Date(prev.createdAt), new Date(item.createdAt));
              return (
                <div key={item.id}>
                  {showDateSeparator && (
                    <div className="flex items-center gap-3 py-3 px-4">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[11px] text-muted-foreground font-medium">
                        {formatDateSeparator(item.createdAt)}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  {item.kind === 'note' ? (
                    <NoteBubble
                      note={item.data}
                      isPinned={!!item.data.pinnedAt}
                      canDelete={canDeleteNote(item.data)}
                      onPin={onPinNote}
                      onUnpin={onUnpinNote}
                      onDelete={onDeleteNote}
                    />
                  ) : (
                    <MessageBubble
                      onCreditMessage={onCreditMessage}
                      creditAttached={creditMessageIds.includes(item.data.id)}
                      creditBusy={creditBusy}
                      onGfinMessage={onGfinMessage}
                      gfinAttached={gfinMessageIds.includes(item.data.id)}
                      gfinBusy={gfinBusy}
                      message={item.data}
                      customerAvatar={avatarUrl || undefined}
                      customerInitial={displayName[0]}
                    />
                  )}
                </div>
              );
            })}
            {isCustomerTyping && (
              <div className="px-4 py-1.5 flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-[11px] text-muted-foreground">กำลังพิมพ์...</span>
              </div>
            )}
            {staffTypingName && (
              <div className="px-4 py-1.5 flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-[11px] text-muted-foreground leading-snug">{staffTypingName} กำลังพิมพ์…</span>
              </div>
            )}
            {/* In-flight "sending" ghosts — keyed by clientMessageId; each drops when its saved row lands. */}
            {(pendingSends ?? [])
              .filter((p) => !messages.some((m: any) => m.clientMessageId === p.clientMessageId))
              .map((p) => (
                <div key={p.clientMessageId} className="flex justify-end mb-3">
                  <div className="max-w-[75%] rounded-2xl rounded-br-md bg-primary/60 px-3.5 py-2 text-sm text-primary-foreground leading-relaxed wrap-anywhere">
                    <span className="whitespace-pre-wrap">{p.text}</span>
                    <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-80">
                      <Loader2 className="size-3 animate-spin" /> กำลังส่ง
                    </span>
                  </div>
                </div>
              ))}
            {/* Failed sends — unified HTTP + WS failure path; retry re-sends. */}
            {(failedSends ?? []).map((f) => (
              <div key={f.id} className="flex justify-end mb-3">
                <div className="max-w-[75%] rounded-2xl rounded-br-md border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-sm text-foreground leading-relaxed wrap-anywhere">
                  <span className="whitespace-pre-wrap">{f.text}</span>
                  <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-destructive leading-snug">
                    <AlertCircle className="size-3 shrink-0" />{' '}
                    {f.source === 'ws' ? 'ส่งถึงลูกค้าไม่สำเร็จ' : 'ส่งไม่สำเร็จ'}
                    {/* เหตุจริงจาก Facebook (สเปก §8.1) — ไม่เงียบ ไม่เดา */}
                    {f.reason && <span className="font-normal text-destructive/80">· {f.reason}</span>}
                    <button
                      type="button"
                      onClick={() => onRetrySend?.(f.id, f.text)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-destructive/15"
                    >
                      <RotateCw className="size-3" /> ลองใหม่
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {/* Scroll anchor stays LAST so jump-to-latest also reveals
                sending/failed ghosts rendered below the saved messages. */}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* หน้าต่าง 24 ชม. ของ Facebook (สเปก §8.1) — เตือน ไม่ปิดปุ่ม · อ่านจาก session.lastCustomerAt ที่เซิร์ฟเวอร์ตั้ง */}
      {!isResolved && !isNoteMode && fbWindow === 'closing' && (
        <div role="status" className="flex items-start gap-2 border-t border-border/60 bg-warning/10 px-3 py-2 text-xs leading-snug text-foreground">
          <Clock className="mt-0.5 size-3.5 shrink-0 text-warning-strong" />
          <span><span className="font-semibold">ตอบได้อีก {fbWindowLeftText(session.lastCustomerAt)}</span> ก่อน Facebook ปิดหน้าต่าง 24 ชั่วโมง</span>
        </div>
      )}
      {!isResolved && !isNoteMode && fbWindow === 'closed' && (
        <div role="status" className="flex items-start gap-2 border-t border-border/60 bg-muted px-3 py-2 text-xs leading-snug text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span><span className="font-semibold text-foreground">พ้น 24 ชั่วโมงแล้ว</span> Facebook อาจไม่ให้ส่งข้อความปกติ ถ้าส่งไม่ถึงให้ติดต่อทางโทรศัพท์แทน</span>
        </div>
      )}

      {/* AI Suggestions */}
      {!isResolved && !isNoteMode && (
        <div className="border-t border-border/60 px-2">
          <PrepareOfferDialog key={session.id} roomId={session.id} onInsert={(text) => { setSelectedSuggestion(null); insertAtCaret(text); }} />
        </div>
      )}
      {!isResolved && (
        <AiSuggestPanel
          roomId={session.id}
          onSelectSuggestion={handleSelectSuggestion}
          lastMessageAt={lastMessageAt}
        />
      )}

      {/* Input */}
      {!isResolved && (
        <div className="group/composer shrink-0 border-t border-border/60 px-3 pt-2 pb-3 bg-card">
          {/* แท็บโหมดเกาะขอบบนของการ์ด (แบบที่เจ้าของโอเค 2026-09-06): ตอบลูกค้า | โน้ตภายใน */}
          {onAddNote && (
            <div className="ml-3 flex items-end gap-0.5" role="radiogroup" aria-label="โหมดช่องพิมพ์">
              <button
                type="button"
                role="radio"
                aria-checked={!isNoteMode}
                onClick={() => { setComposerMode('chat'); inputRef.current?.focus(); }}
                className={cn(
                  'relative z-10 -mb-px inline-flex h-7 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 text-[12px] font-semibold transition-colors',
                  !isNoteMode ? 'border-border bg-card text-primary group-focus-within/composer:border-primary/60' : 'border-border bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                <MessageSquare className="size-3.5" /> ตอบลูกค้า
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={isNoteMode}
                onClick={() => { setComposerMode('note'); requestAnimationFrame(() => noteContainerRef.current?.querySelector('textarea')?.focus()); }}
                className={cn(
                  'relative z-10 -mb-px inline-flex h-7 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 text-[12px] font-semibold transition-colors',
                  isNoteMode ? 'border-warning/50 bg-warning/10 text-foreground dark:border-amber-400/40 dark:bg-amber-400/10' : 'border-border bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                <StickyNote className="size-3.5" /> โน้ตภายใน
              </button>
            </div>
          )}
          <div
            data-chat-composer-card
            className={cn(
              'flex flex-col rounded-xl border focus-within:outline-hidden transition-[box-shadow,border-color]',
              isNoteMode
                ? 'border-warning/50 bg-warning/10 focus-within:ring-2 focus-within:ring-warning-strong dark:border-amber-400/40 dark:bg-amber-400/10'
                : 'border-border bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-primary',
            )}
          >
            {onAddNote && <div ref={noteContainerRef} hidden={!isNoteMode} onKeyDown={e => { if (e.key === 'Escape') { setComposerMode('chat'); requestAnimationFrame(() => inputRef.current?.focus()); } }}><NoteMentionInput roomId={session.id} onSave={onAddNote} /></div>}
            <div hidden={isNoteMode}>
            {/* The card owns focus; suppress both the base ring and admin theme outline. */}
            <textarea
              data-chat-composer-input
              ref={inputRef}
              value={inputText}
              onChange={(e) => {
                const v = e.target.value;
                setInputText(v);
                // Drop the AI-draft association once the box is cleared, so an
                // unrelated follow-up isn't logged as an "edit" of that draft.
                if (selectedSuggestion && v.trim() === '') setSelectedSuggestion(null);
                if (v.trim()) emitTyping();
                else endTyping();
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={endTyping}
              placeholder={isNoteMode ? 'พิมพ์โน้ตภายใน…' : `พิมพ์ข้อความถึง ${displayName}…`}
              aria-label={isNoteMode ? 'พิมพ์โน้ตภายใน' : 'พิมพ์ข้อความ'}
              rows={2}
              className="block w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-2.5 pb-1 text-sm leading-relaxed border-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 max-h-32 placeholder:text-muted-foreground/60"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-1.5 pb-1.5 pt-0.5">
              {isNoteMode ? (
                <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 pl-2 text-[12px] leading-snug text-amber-800 dark:text-amber-200">
                  <Lock className="size-3.5 shrink-0" /> <span>เห็นเฉพาะทีมงาน · ไม่ส่งถึงลูกค้า</span>
                </span>
              ) : (
                <div className="flex shrink-0 items-center gap-0.5">
            {/* File upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingFile}
              aria-label="แนบไฟล์"
              className="size-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="แนบไฟล์/รูปภาพ"
            >
              {isUploadingFile ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            {/* Emoji / Sticker picker */}
            <ChatMediaPicker
              model={mediaPicker}
              open={emojiOpen}
              onOpenChange={setEmojiOpen}
              isLineChannel={!!isLineChannel}
              onEmoji={insertEmoji}
              onSticker={handleStickerClick}
              onGif={(url) => {
                endTyping();
                onSendMessage(`[gif:${url}]`);
                setEmojiOpen(false);
              }}
            />
            {/* Product picker */}
            <button
              onClick={() => setShowProductPicker(true)}
              disabled={!session?.id}
              aria-label="ส่งข้อมูลสินค้า"
              className="size-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="ส่งข้อมูล/รูปสินค้า"
            >
              <Smartphone className="w-4 h-4" />
            </button>
            {/* Message template picker */}
            <button
              onClick={() => setShowTemplatePicker(true)}
              disabled={!session?.id}
              aria-label="ข้อความสำเร็จรูป"
              className="size-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="ข้อความสำเร็จรูป (Ctrl+K)"
            >
              <MessageSquareQuote className="w-4 h-4" />
            </button>
                </div>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <span className="hidden @[36rem]:inline text-[11px] leading-snug text-muted-foreground/80 whitespace-nowrap">
                  {isNoteMode ? 'Enter บันทึก · Esc กลับไปตอบ' : 'Enter ส่ง · Shift+Enter ขึ้นบรรทัด'}
                </span>
                <button
                  onClick={() => void handleSend()}
                  disabled={!inputText.trim() || isSending}
                  aria-label={isNoteMode ? 'บันทึกโน้ต' : 'ส่งข้อความ'}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-semibold leading-snug transition-all duration-200',
                    inputText.trim() && !isSending
                      ? isNoteMode
                        ? 'bg-warning text-amber-950 shadow-sm hover:bg-warning/90 dark:bg-amber-400 dark:hover:bg-amber-300'
                        : 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md'
                      : 'bg-muted text-muted-foreground/50 cursor-not-allowed',
                  )}
                >
                  {isNoteMode ? 'บันทึกโน้ต' : 'ส่ง'}
                  {isSending ? <Loader2 className="size-4 animate-spin" /> : isNoteMode ? <StickyNote className="size-4" /> : <Send className="size-4" />}
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* แถบห้องปิดแล้ว — แทนช่องพิมพ์ · ปุ่ม "เปิดงานกลับ" อยู่หัวห้อง (ไม่ซ้ำ 2 ที่) */}
      {isResolved && (
        <div className="border-t border-border/60 bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground leading-snug">
          ห้องนี้ปิดงานแล้ว — กด "เปิดงานกลับ" ที่หัวห้องเพื่อพิมพ์ต่อ (ลูกค้าทักใหม่ห้องกลับมาเอง)
        </div>
      )}

      {/* Message Template Picker */}
      <MessageTemplatePicker
        isOpen={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        onInsert={insertAtCaret}
        roomId={session?.id ?? null}
      />

      <ProductPickerDialog
        isOpen={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        onInsert={insertAtCaret}
        roomId={session?.id ?? null}
      />
    </div>
  );
}

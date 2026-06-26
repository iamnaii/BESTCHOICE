import { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Send, MoreVertical, ArrowLeft, Paperclip, Smile, Pin, PinOff, MessageSquare, UserCircle2, MessageSquareQuote, Loader2, Upload, Eye, Bell, BellOff, Bot, BotOff, AlertCircle, RotateCw } from 'lucide-react';
import { isSameDay } from 'date-fns';
import { formatDateSeparator } from '@/lib/chat-time';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import MessageBubble from './MessageBubble';
import { swapRoomDraft } from './composer-draft';
import SessionActions from './SessionActions';
import MessageTemplatePicker from './MessageTemplatePicker';
import AiSuggestPanel from './AiSuggestPanel';
import { useKeyboardShortcuts, isEditableTarget } from '../hooks/useKeyboardShortcuts';
import api from '@/lib/api';
import { getGeneratedAvatarUrl } from '@/lib/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isAcceptedFile } from './upload-accept';

// ─── Emoji data ───────────────────────────────────────────────────────────────
const EMOJI_CATEGORIES = [
  {
    label: '😊',
    name: 'ใช้บ่อย',
    emojis: ['😊', '👍', '🙏', '❤️', '😄', '👋', '✅', '📱', '💰', '🎉', '😍', '🤣', '😢', '😮', '🔥', '💯', '👏', '🙌', '💪', '🤝'],
  },
  {
    label: '😀',
    name: 'หน้า',
    emojis: ['😀', '😃', '😁', '😆', '🥹', '😅', '🤣', '😂', '🙂', '😉', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡'],
  },
  {
    label: '👍',
    name: 'มือ',
    emojis: ['👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '✌️', '🤞', '🫰', '🤟', '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤙', '💪'],
  },
  {
    label: '❤️',
    name: 'หัวใจ',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💝', '💘', '💌'],
  },
  {
    label: '🏷️',
    name: 'สิ่งของ',
    emojis: ['📱', '💻', '⌨️', '🖥️', '💰', '💵', '💳', '🧾', '📦', '🚚', '🏪', '🏢', '📋', '📄', '✏️', '📌', '🔔', '⭐', '🌟', '💡'],
  },
];

// ─── LINE Sticker data ────────────────────────────────────────────────────────
const LINE_STICKER_PACKAGES = [
  {
    packageId: 11537,
    name: 'Brown & Cony',
    stickers: [
      { id: 52002734 }, { id: 52002735 }, { id: 52002736 }, { id: 52002737 },
      { id: 52002738 }, { id: 52002739 }, { id: 52002740 }, { id: 52002741 },
      { id: 52002742 }, { id: 52002743 }, { id: 52002744 }, { id: 52002745 },
    ],
  },
  {
    packageId: 11538,
    name: 'Brown & Friends',
    stickers: [
      { id: 51626494 }, { id: 51626495 }, { id: 51626496 }, { id: 51626497 },
      { id: 51626498 }, { id: 51626499 }, { id: 51626500 }, { id: 51626501 },
      { id: 51626502 }, { id: 51626503 }, { id: 51626504 }, { id: 51626505 },
    ],
  },
  {
    packageId: 789,
    name: 'Moon James',
    stickers: [
      { id: 10855 }, { id: 10856 }, { id: 10857 }, { id: 10858 }, { id: 10859 },
      { id: 10860 }, { id: 10861 }, { id: 10862 }, { id: 10863 }, { id: 10864 },
    ],
  },
];

const stickerAnimUrl = (stickerId: number) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker_animation.png`;
const stickerStaticUrl = (stickerId: number) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker@2x.png`;

const MAX_COMPOSER_HEIGHT = 128; // px — matches Tailwind max-h-32 (8rem)

interface ChatPanelProps {
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
  failedSends?: { id: string; text: string; source?: 'http' | 'ws' }[];
  onRetrySend?: (id: string, text: string) => void;
  onStartTyping?: () => void;
  onStopTyping?: () => void;
  staffTypingName?: string | null;
}

export default function ChatPanel({
  session,
  messages,
  isLoadingMessages,
  isCustomerTyping = false,
  onSendMessage,
  onSendFile,
  onSendSticker,
  onBack,
  onAssign,
  onTransfer,
  onResolve,
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
  const [isSending, setIsSending] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<{ aiDraft: string; intent: string } | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  // picker top-level tab
  type PickerTab = 'emoji' | 'sticker' | 'gif';
  const [pickerTab, setPickerTab] = useState<PickerTab>('emoji');
  // emoji sub-tab (category index)
  const [emojiCategory, setEmojiCategory] = useState(0);
  // sticker sub-tab (package index)
  const [stickerPackage, setStickerPackage] = useState(0);

  // GIF picker state
  const [gifSearch, setGifSearch] = useState('');
  const gifSearchDebounced = useDebounce(gifSearch, 500);
  const [gifs, setGifs] = useState<any[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY || 'dc6zaTOxFJmzC';
  const gifApiUrl = gifSearchDebounced
    ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(gifSearchDebounced)}&limit=20&rating=g`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=20&rating=g`;

  // Fetch GIFs whenever the GIF tab is active or the search query changes
  useEffect(() => {
    if (pickerTab !== 'gif') return;
    setLoadingGifs(true);
    fetch(gifApiUrl, { signal: AbortSignal.timeout(10_000) })
      .then((r) => r.json())
      .then((d) => setGifs(d.data ?? []))
      .catch(() => setGifs([]))
      .finally(() => setLoadingGifs(false));
  }, [gifApiUrl, pickerTab]);

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
  }, [messages.length, roomId]);

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
    if (!text || isSending) return;
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
        <p className="text-sm font-semibold text-foreground/60 leading-snug">เลือกการสนทนา</p>
        <p className="text-xs text-muted-foreground/60 mt-1.5 max-w-[200px] leading-relaxed">
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
  const isResolved = session.sessionStatus === 'RESOLVED';

  return (
    <div
      className="relative flex-1 flex flex-col h-full"
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
            <span className="text-sm font-medium leading-snug">วางไฟล์เพื่อส่ง</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-card">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label="กลับ" className="lg:hidden p-1 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          {/* Customer avatar */}
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 ring-2 ring-background">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-muted-foreground text-sm font-bold">{displayName[0]}</span>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-[13px] text-foreground">{displayName}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold',
                  session.channel === 'LINE_FINANCE' || session.channel === 'LINE_SHOP'
                    ? 'bg-[#06C755]/10 text-[#06C755]'
                    : session.channel === 'FACEBOOK'
                      ? 'bg-[#1877F2]/10 text-[#1877F2]'
                      : session.channel === 'TIKTOK'
                        ? 'bg-foreground/10 text-foreground'
                        : 'bg-muted text-foreground/70',
                )}
              >
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  session.channel === 'LINE_FINANCE' || session.channel === 'LINE_SHOP'
                    ? 'bg-[#06C755]'
                    : session.channel === 'FACEBOOK'
                      ? 'bg-[#1877F2]'
                      : 'bg-current',
                )} />
                {session.channel === 'LINE_FINANCE'
                  ? 'LINE การเงิน'
                  : session.channel === 'LINE_SHOP'
                    ? 'LINE ร้าน'
                    : session.channel === 'FACEBOOK'
                      ? 'Facebook'
                      : session.channel === 'TIKTOK'
                        ? 'TikTok'
                        : 'Web'}
              </span>
              <span className="w-px h-3 bg-border" />
              <span className="text-[10px] text-muted-foreground/70 font-medium">{session.sessionStatus}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onShowCustomerInfo && (
            <button
              onClick={onShowCustomerInfo}
              className="xl:hidden p-1.5 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground/70 hover:bg-accent rounded-lg"
              title="ข้อมูลลูกค้า"
              aria-label="ข้อมูลลูกค้า"
            >
              <UserCircle2 className="w-5 h-5" />
            </button>
          )}
          {onToggleRoomMute && (
            <button
              type="button"
              onClick={onToggleRoomMute}
              title={roomMuted ? 'เปิดแจ้งเตือนห้องนี้' : 'ปิดแจ้งเตือนห้องนี้'}
              aria-label="สลับการแจ้งเตือนห้องนี้"
              className="p-1.5 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground/70 hover:bg-accent rounded-lg"
            >
              {roomMuted ? <BellOff className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
            </button>
          )}
          {onToggleAi && (
            <button
              type="button"
              onClick={onToggleAi}
              disabled={aiTogglePending}
              title={aiPaused ? 'เปิด AI ตอบอัตโนมัติ' : 'หยุด AI (พนักงานตอบเอง)'}
              aria-label="สลับสถานะ AI"
              className={cn(
                'p-1.5 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-50',
                aiPaused
                  ? 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  : 'text-primary bg-primary/10 hover:bg-primary/20',
              )}
            >
              {aiPaused ? <BotOff className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
            </button>
          )}
          <button
            onClick={() => pinMutation.mutate(!!session.pinnedAt)}
            disabled={pinMutation.isPending}
            className={cn(
              'p-1.5 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg transition-colors',
              session.pinnedAt
                ? 'text-warning hover:bg-warning/10'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground/70',
            )}
            title={session.pinnedAt ? 'ถอดหมุด' : 'ปักหมุด'}
            aria-label={session.pinnedAt ? 'ถอดหมุดห้องแชท' : 'ปักหมุดห้องแชท'}
          >
            {session.pinnedAt ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowActions(!showActions)}
            aria-label="ตัวเลือกเพิ่มเติม"
            aria-expanded={showActions}
            className="p-1.5 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground/70 hover:bg-accent rounded-lg"
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
        <div className="flex items-center gap-2 bg-warning/10 px-4 py-1.5 text-[11px] text-warning leading-snug border-b border-warning/20">
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
      <div className="flex-1 overflow-y-auto px-4 py-3" role="log" aria-label="ประวัติข้อความ">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            กำลังโหลดข้อความ...
          </div>
        ) : (
          <>
            {messages.map((msg, i) => {
              const showDateSeparator =
                i === 0 ||
                !isSameDay(new Date(messages[i - 1].createdAt), new Date(msg.createdAt));
              return (
                <div key={msg.id}>
                  {showDateSeparator && (
                    <div className="flex items-center gap-3 py-3 px-4">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[11px] text-muted-foreground font-medium">
                        {formatDateSeparator(msg.createdAt)}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    customerAvatar={avatarUrl || undefined}
                    customerInitial={displayName[0]}
                  />
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
            <div ref={messagesEndRef} />
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
          </>
        )}
      </div>

      {/* AI Suggestions */}
      {!isResolved && (
        <AiSuggestPanel
          roomId={session.id}
          onSelectSuggestion={handleSelectSuggestion}
          lastMessageAt={lastMessageAt}
        />
      )}

      {/* Input */}
      {!isResolved && (
        <div className="border-t border-border/60 px-3 py-2.5 bg-card">
          <div className="flex items-end gap-1.5">
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
              className="p-2 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="แนบไฟล์/รูปภาพ"
            >
              {isUploadingFile ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            {/* Emoji / Sticker picker */}
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button
                  aria-label="อิโมจิ / สติกเกอร์"
                  className={cn(
                    'p-2 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg transition-colors',
                    emojiOpen
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted',
                  )}
                  title="Emoji / สติกเกอร์"
                >
                  <Smile className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                className="w-[min(20rem,calc(100vw-1rem))] p-0 shadow-lg border border-border rounded-xl overflow-hidden"
                sideOffset={6}
              >
                {/* ── Top-level tabs ── */}
                <div className="flex border-b border-border bg-card">
                  <button
                    onClick={() => setPickerTab('emoji')}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors',
                      pickerTab === 'emoji'
                        ? 'text-primary border-b-2 border-primary -mb-px'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    😊 Emoji
                  </button>

                  {isLineChannel && (
                    <button
                      onClick={() => setPickerTab('sticker')}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors',
                        pickerTab === 'sticker'
                          ? 'text-primary border-b-2 border-primary -mb-px'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      📦 สติกเกอร์
                    </button>
                  )}

                  {!isLineChannel && (
                    <button
                      onClick={() => setPickerTab('gif')}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors',
                        pickerTab === 'gif'
                          ? 'text-primary border-b-2 border-primary -mb-px'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      GIF
                    </button>
                  )}
                </div>

                {/* ── Emoji tab ── */}
                {pickerTab === 'emoji' && (
                  <div>
                    {/* Category sub-tabs */}
                    <div className="flex gap-1 px-2 py-1.5 border-b border-border bg-muted/50">
                      {EMOJI_CATEGORIES.map((cat, i) => (
                        <button
                          key={cat.name}
                          onClick={() => setEmojiCategory(i)}
                          title={cat.name}
                          className={cn(
                            'p-1 rounded text-base transition-colors',
                            emojiCategory === i ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted',
                          )}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    {/* Emoji grid */}
                    <div className="grid grid-cols-8 gap-0.5 p-2 max-h-[200px] overflow-y-auto">
                      {EMOJI_CATEGORIES[emojiCategory]?.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => insertEmoji(emoji)}
                          className="w-8 h-8 flex items-center justify-center text-lg hover:bg-muted rounded transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Sticker tab (LINE only) ── */}
                {pickerTab === 'sticker' && isLineChannel && (
                  <div>
                    {/* Package sub-tabs */}
                    <div className="flex gap-1 px-2 py-1.5 border-b border-border bg-muted/50 overflow-x-auto">
                      {LINE_STICKER_PACKAGES.map((pkg, i) => (
                        <button
                          key={pkg.packageId}
                          onClick={() => setStickerPackage(i)}
                          className={cn(
                            'flex-shrink-0 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap',
                            stickerPackage === i
                              ? 'bg-[#06C755]/10 text-[#06C755]'
                              : 'text-muted-foreground hover:bg-muted',
                          )}
                        >
                          {pkg.name}
                        </button>
                      ))}
                    </div>
                    {/* Sticker grid */}
                    <div className="grid grid-cols-4 gap-2 p-2 max-h-[200px] overflow-y-auto">
                      {LINE_STICKER_PACKAGES[stickerPackage]?.stickers.map((sticker) => (
                        <button
                          key={sticker.id}
                          onClick={() =>
                            handleStickerClick(
                              LINE_STICKER_PACKAGES[stickerPackage].packageId,
                              sticker.id,
                            )
                          }
                          className="w-14 h-14 flex items-center justify-center hover:bg-muted rounded-lg transition-colors overflow-hidden"
                          title={`Sticker ${sticker.id}`}
                        >
                          <img
                            src={stickerAnimUrl(sticker.id)}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = stickerStaticUrl(sticker.id);
                            }}
                            alt={`sticker-${sticker.id}`}
                            className="w-[60px] h-[60px] object-contain hover:scale-110 transition-transform"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── GIF tab (non-LINE only) ── */}
                {pickerTab === 'gif' && !isLineChannel && (
                  <div className="flex flex-col">
                    {/* Search input */}
                    <div className="px-2 py-1.5 border-b border-border">
                      <input
                        type="text"
                        placeholder="ค้นหา GIF..."
                        value={gifSearch}
                        onChange={(e) => setGifSearch(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-background"
                      />
                    </div>
                    {/* GIF grid */}
                    <div className="grid grid-cols-2 gap-1 p-2 max-h-[200px] overflow-y-auto">
                      {loadingGifs ? (
                        <div className="col-span-2 text-center py-4 text-xs text-muted-foreground">
                          กำลังโหลด...
                        </div>
                      ) : gifs.length === 0 ? (
                        <div className="col-span-2 text-center py-4 text-xs text-muted-foreground">
                          ไม่พบ GIF
                        </div>
                      ) : (
                        gifs.map((gif: any) => (
                          <button
                            key={gif.id}
                            type="button"
                            onClick={() => {
                              const url = gif.images?.fixed_width?.url;
                              if (url) {
                                endTyping();
                                onSendMessage(`[gif:${url}]`);
                                setEmojiOpen(false);
                              }
                            }}
                            aria-label={gif.title || 'ส่ง GIF'}
                            className="block rounded-lg overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                          >
                            <img
                              src={gif.images?.fixed_width_small?.url ?? gif.images?.fixed_width?.url}
                              alt={gif.title || ''}
                              loading="lazy"
                              className="w-full h-auto"
                            />
                          </button>
                        ))
                      )}
                    </div>
                    {/* Giphy attribution */}
                    <div className="text-[9px] text-muted-foreground text-center pb-1 pt-0.5 border-t border-border">
                      Powered by GIPHY
                    </div>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            {/* Message template picker */}
            <button
              onClick={() => setShowTemplatePicker(true)}
              disabled={!session?.id}
              aria-label="ข้อความสำเร็จรูป"
              className="p-2 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="ข้อความสำเร็จรูป (Ctrl+K)"
            >
              <MessageSquareQuote className="w-4 h-4" />
            </button>
            <textarea
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
              placeholder="พิมพ์ข้อความ..."
              aria-label="พิมพ์ข้อความ"
              rows={1}
              className="flex-1 resize-none overflow-y-auto px-3 py-2 text-sm bg-muted/40 rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background max-h-32 transition-colors placeholder:text-muted-foreground/40"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!inputText.trim() || isSending}
              aria-label="ส่งข้อความ"
              className={cn(
                'p-2 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg transition-all duration-200',
                inputText.trim() && !isSending
                  ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md'
                  : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
              )}
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="hidden lg:block mt-1 px-1 text-[10px] leading-snug text-muted-foreground/40">
            Enter ส่ง · Shift+Enter ขึ้นบรรทัด
          </p>
        </div>
      )}

      {/* Message Template Picker */}
      <MessageTemplatePicker
        isOpen={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        onInsert={(content) => {
          // Insert at the caret (like emoji insertion) rather than always
          // appending, so a snippet dropped mid-message lands where intended.
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
        }}
        roomId={session?.id ?? null}
      />
    </div>
  );
}

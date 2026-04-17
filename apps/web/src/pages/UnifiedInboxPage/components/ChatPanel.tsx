import { useRef, useEffect, useState, useMemo } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Send, MoreVertical, ArrowLeft, Paperclip, Smile, Pin, PinOff, MessageSquare } from 'lucide-react';
import { format, isSameDay } from 'date-fns';
import { th } from 'date-fns/locale/th';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import MessageBubble from './MessageBubble';
import SessionActions from './SessionActions';
import CommandPalette from './CommandPalette';
import AiSuggestPanel from './AiSuggestPanel';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import api from '@/lib/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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

interface ChatPanelProps {
  session: any;
  messages: any[];
  isLoadingMessages: boolean;
  isCustomerTyping?: boolean;
  onSendMessage: (text: string) => void;
  onSendFile?: (file: File) => void;
  onSendSticker?: (params: { packageId: number; stickerId: number }) => void;
  onBack: () => void;
  onAssign: (staffId: string) => void;
  onTransfer: (staffId: string) => void;
  onResolve: () => void;
  onReturnToAI: () => void;
  currentUserId: string;
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
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState<{ aiDraft: string; intent: string } | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
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
      onOpenPalette: () => setShowPalette(true),
      onResolve,
      onEscape: () => setShowPalette(false),
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
    if (onSendSticker) {
      onSendSticker({ packageId, stickerId });
    } else {
      onSendMessage(`[sticker:${packageId}:${stickerId}]`);
    }
    setEmojiOpen(false);
  };

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const getLastCustomerMessage = () => {
    const customerMsgs = messages.filter((m: any) => m.role === 'CUSTOMER');
    return customerMsgs[customerMsgs.length - 1]?.text ?? customerMsgs[customerMsgs.length - 1]?.content ?? '';
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    onSendMessage(text);
    if (selectedSuggestion) {
      const type = text === selectedSuggestion.aiDraft ? 'ACCEPT' : 'EDIT';
      api.post('/staff-chat/ai/training-feedback', {
        roomId: session.id,
        type,
        customerMessage: getLastCustomerMessage(),
        aiDraft: selectedSuggestion.aiDraft,
        humanEdit: type === 'EDIT' ? text : undefined,
        intent: selectedSuggestion.intent,
      }).catch(() => {});
      setSelectedSuggestion(null);
    }
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCannedResponse = (content: string) => {
    setInputText((prev) => (prev ? prev + ' ' + content : content));
    inputRef.current?.focus();
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
    session.customer?.avatarUrl || session.customer?.lineAvatarUrl || session.pictureUrl;
  const isResolved = session.sessionStatus === 'RESOLVED';

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-card">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="lg:hidden p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors">
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
          <button
            onClick={() => pinMutation.mutate(!!session.pinnedAt)}
            disabled={pinMutation.isPending}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              session.pinnedAt
                ? 'text-amber-500 hover:bg-amber-50'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground/70',
            )}
            title={session.pinnedAt ? 'ถอดหมุด' : 'ปักหมุด'}
          >
            {session.pinnedAt ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1.5 text-muted-foreground hover:text-foreground/70 hover:bg-accent rounded-lg"
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
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
                        {format(new Date(msg.createdAt), 'd MMMM yyyy', { locale: th })}
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
            <div ref={messagesEndRef} />
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
              className="p-2 text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              title="แนบไฟล์/รูปภาพ"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            {/* Emoji / Sticker picker */}
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    'p-2 rounded-lg transition-colors',
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
                className="w-80 p-0 shadow-lg border border-border rounded-xl overflow-hidden"
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
                          <img
                            key={gif.id}
                            src={gif.images?.fixed_width_small?.url ?? gif.images?.fixed_width?.url}
                            alt={gif.title ?? 'gif'}
                            className="w-full h-auto rounded cursor-pointer hover:opacity-80 transition-opacity"
                            loading="lazy"
                            onClick={() => {
                              const url = gif.images?.fixed_width?.url;
                              if (url) {
                                onSendMessage(`[gif:${url}]`);
                                setEmojiOpen(false);
                              }
                            }}
                          />
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
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="พิมพ์ข้อความ..."
              rows={1}
              className="flex-1 resize-none px-3 py-2 text-sm bg-muted/40 rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background max-h-32 transition-all placeholder:text-muted-foreground/40"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className={cn(
                'p-2 rounded-lg transition-all duration-200',
                inputText.trim()
                  ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md'
                  : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Command Palette */}
      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        onSelectCannedResponse={handleCannedResponse}
        onResolve={onResolve}
        roomId={session?.id ?? null}
      />
    </div>
  );
}

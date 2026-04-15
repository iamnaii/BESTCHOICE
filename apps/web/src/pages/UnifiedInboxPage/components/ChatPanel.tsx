import { useRef, useEffect, useState, useMemo } from 'react';
import { Send, MoreVertical, ArrowLeft, Paperclip, Smile, Pin, PinOff } from 'lucide-react';
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

const stickerUrl = (stickerId: number) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker.png`;

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
  // emoji picker state
  const [emojiTabIdx, setEmojiTabIdx] = useState(0); // index into EMOJI_CATEGORIES or sticker sentinel
  const [stickerPkgIdx, setStickerPkgIdx] = useState(0);
  const STICKER_TAB_IDX = EMOJI_CATEGORIES.length; // sentinel value for sticker tab

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
      // fallback: send as special text
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
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        เลือกการสนทนาจากรายการด้านซ้าย
      </div>
    );
  }

  const displayName = session.customer?.name ?? session.lineUserId?.slice(0, 12) ?? 'ไม่ทราบชื่อ';
  const isResolved = session.sessionStatus === 'RESOLVED';

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="lg:hidden text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h3 className="font-medium text-sm text-gray-900">{displayName}</h3>
            <span className="text-xs text-gray-400">
              {session.channel.replace('_', ' ')} · {session.sessionStatus}
            </span>
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
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
            )}
            title={session.pinnedAt ? 'ถอดหมุด' : 'ปักหมุด'}
          >
            {session.pinnedAt ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
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
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
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
                  <MessageBubble message={msg} />
                </div>
              );
            })}
            {isCustomerTyping && (
              <div className="px-4 py-1.5 flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
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
        <div className="border-t border-gray-200 p-3 bg-white">
          <div className="flex items-end gap-2">
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
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="แนบไฟล์/รูปภาพ"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            {/* Emoji / Sticker picker */}
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    'p-2 rounded-lg transition-colors',
                    emojiOpen
                      ? 'text-blue-500 bg-blue-50'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100',
                  )}
                  title="Emoji / สติกเกอร์"
                >
                  <Smile className="w-5 h-5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                className="w-72 p-0 shadow-lg border border-gray-200 rounded-xl overflow-hidden"
                sideOffset={6}
              >
                {/* Category tabs */}
                <div className="flex border-b border-gray-100 bg-gray-50 overflow-x-auto">
                  {EMOJI_CATEGORIES.map((cat, idx) => (
                    <button
                      key={cat.name}
                      onClick={() => setEmojiTabIdx(idx)}
                      title={cat.name}
                      className={cn(
                        'flex-shrink-0 px-2.5 py-2 text-base transition-colors',
                        emojiTabIdx === idx
                          ? 'border-b-2 border-blue-500 bg-white'
                          : 'hover:bg-gray-100',
                      )}
                    >
                      {cat.label}
                    </button>
                  ))}
                  {/* Sticker tab — LINE rooms only */}
                  {isLineChannel && (
                    <button
                      onClick={() => setEmojiTabIdx(STICKER_TAB_IDX)}
                      title="สติกเกอร์"
                      className={cn(
                        'flex-shrink-0 px-2.5 py-2 text-xs font-medium transition-colors',
                        emojiTabIdx === STICKER_TAB_IDX
                          ? 'border-b-2 border-blue-500 bg-white text-blue-600'
                          : 'text-gray-500 hover:bg-gray-100',
                      )}
                    >
                      📦
                    </button>
                  )}
                </div>

                {/* Emoji grid */}
                {emojiTabIdx < STICKER_TAB_IDX && (
                  <div className="p-2 max-h-52 overflow-y-auto">
                    <div className="grid grid-cols-8 gap-0.5">
                      {EMOJI_CATEGORIES[emojiTabIdx]?.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => insertEmoji(emoji)}
                          className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-100 rounded transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sticker panel */}
                {emojiTabIdx === STICKER_TAB_IDX && (
                  <div className="flex flex-col">
                    {/* Package tabs */}
                    <div className="flex border-b border-gray-100 overflow-x-auto bg-white">
                      {LINE_STICKER_PACKAGES.map((pkg, idx) => (
                        <button
                          key={pkg.packageId}
                          onClick={() => setStickerPkgIdx(idx)}
                          className={cn(
                            'flex-shrink-0 px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                            stickerPkgIdx === idx
                              ? 'border-b-2 border-blue-500 text-blue-600'
                              : 'text-gray-500 hover:bg-gray-50',
                          )}
                        >
                          {pkg.name}
                        </button>
                      ))}
                    </div>
                    {/* Sticker grid */}
                    <div className="p-2 max-h-48 overflow-y-auto">
                      <div className="grid grid-cols-4 gap-1">
                        {LINE_STICKER_PACKAGES[stickerPkgIdx]?.stickers.map((sticker) => (
                          <button
                            key={sticker.id}
                            onClick={() =>
                              handleStickerClick(
                                LINE_STICKER_PACKAGES[stickerPkgIdx].packageId,
                                sticker.id,
                              )
                            }
                            className="w-14 h-14 flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors overflow-hidden"
                            title={`Sticker ${sticker.id}`}
                          >
                            <img
                              src={stickerUrl(sticker.id)}
                              alt={`sticker-${sticker.id}`}
                              className="w-12 h-12 object-contain"
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
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
              placeholder="พิมพ์ข้อความ... (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
              rows={1}
              className="flex-1 resize-none px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 max-h-32"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="p-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

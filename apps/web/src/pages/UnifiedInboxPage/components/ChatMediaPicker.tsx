import { Smile } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { useChatMediaPicker } from '../hooks/useChatMediaPicker';

// ─── Emoji data ───────────────────────────────────────────────────────────────
const EMOJI_CATEGORIES = [
  {
    label: '😊',
    name: 'ใช้บ่อย',
    emojis: [
      '😊',
      '👍',
      '🙏',
      '❤️',
      '😄',
      '👋',
      '✅',
      '📱',
      '💰',
      '🎉',
      '😍',
      '🤣',
      '😢',
      '😮',
      '🔥',
      '💯',
      '👏',
      '🙌',
      '💪',
      '🤝',
    ],
  },
  {
    label: '😀',
    name: 'หน้า',
    emojis: [
      '😀',
      '😃',
      '😁',
      '😆',
      '🥹',
      '😅',
      '🤣',
      '😂',
      '🙂',
      '😉',
      '😇',
      '🥰',
      '😍',
      '🤩',
      '😘',
      '😗',
      '😚',
      '😙',
      '🥲',
      '😋',
      '😛',
      '😜',
      '🤪',
      '😝',
      '🤑',
      '🤗',
      '🤭',
      '🤫',
      '🤔',
      '🫡',
    ],
  },
  {
    label: '👍',
    name: 'มือ',
    emojis: [
      '👍',
      '👎',
      '👊',
      '✊',
      '🤛',
      '🤜',
      '👏',
      '🙌',
      '🫶',
      '👐',
      '🤲',
      '🤝',
      '🙏',
      '✌️',
      '🤞',
      '🫰',
      '🤟',
      '🤘',
      '👌',
      '🤌',
      '🤏',
      '👈',
      '👉',
      '👆',
      '👇',
      '☝️',
      '✋',
      '🤚',
      '🖐️',
      '🖖',
      '👋',
      '🤙',
      '💪',
    ],
  },
  {
    label: '❤️',
    name: 'หัวใจ',
    emojis: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💔',
      '❤️‍🔥',
      '❤️‍🩹',
      '💕',
      '💞',
      '💓',
      '💗',
      '💖',
      '💝',
      '💘',
      '💌',
    ],
  },
  {
    label: '🏷️',
    name: 'สิ่งของ',
    emojis: [
      '📱',
      '💻',
      '⌨️',
      '🖥️',
      '💰',
      '💵',
      '💳',
      '🧾',
      '📦',
      '🚚',
      '🏪',
      '🏢',
      '📋',
      '📄',
      '✏️',
      '📌',
      '🔔',
      '⭐',
      '🌟',
      '💡',
    ],
  },
];

// ─── LINE Sticker data ────────────────────────────────────────────────────────
const LINE_STICKER_PACKAGES = [
  {
    packageId: 11537,
    name: 'Brown & Cony',
    stickers: [
      { id: 52002734 },
      { id: 52002735 },
      { id: 52002736 },
      { id: 52002737 },
      { id: 52002738 },
      { id: 52002739 },
      { id: 52002740 },
      { id: 52002741 },
      { id: 52002742 },
      { id: 52002743 },
      { id: 52002744 },
      { id: 52002745 },
    ],
  },
  {
    packageId: 11538,
    name: 'Brown & Friends',
    stickers: [
      { id: 51626494 },
      { id: 51626495 },
      { id: 51626496 },
      { id: 51626497 },
      { id: 51626498 },
      { id: 51626499 },
      { id: 51626500 },
      { id: 51626501 },
      { id: 51626502 },
      { id: 51626503 },
      { id: 51626504 },
      { id: 51626505 },
    ],
  },
  {
    packageId: 789,
    name: 'Moon James',
    stickers: [
      { id: 10855 },
      { id: 10856 },
      { id: 10857 },
      { id: 10858 },
      { id: 10859 },
      { id: 10860 },
      { id: 10861 },
      { id: 10862 },
      { id: 10863 },
      { id: 10864 },
    ],
  },
];

const stickerAnimUrl = (stickerId: number) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker_animation.png`;
const stickerStaticUrl = (stickerId: number) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker@2x.png`;

interface Props {
  model: ReturnType<typeof useChatMediaPicker>;
  open: boolean;
  onOpenChange(open: boolean): void;
  isLineChannel: boolean;
  onEmoji(emoji: string): void;
  onSticker(packageId: number, stickerId: number): void;
  onGif(url: string): void;
}

export function ChatMediaPicker({
  model,
  open,
  onOpenChange,
  isLineChannel,
  onEmoji,
  onSticker,
  onGif,
}: Props) {
  const {
    pickerTab,
    setPickerTab,
    emojiCategory,
    setEmojiCategory,
    stickerPackage,
    setStickerPackage,
    gifSearch,
    setGifSearch,
    gifs,
    loadingGifs,
  } = model;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-label="อิโมจิ / สติกเกอร์"
          className={cn(
            'size-11 inline-flex items-center justify-center rounded-lg transition-colors',
            open
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
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
                  onClick={() => onEmoji(emoji)}
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
                    onSticker(LINE_STICKER_PACKAGES[stickerPackage].packageId, sticker.id)
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
                gifs.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() => {
                      const url = gif.images?.fixed_width?.url;
                      if (url) {
                        onGif(url);
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
  );
}

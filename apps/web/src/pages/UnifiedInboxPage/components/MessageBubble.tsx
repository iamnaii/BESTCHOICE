import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface MessageBubbleProps {
  message: {
    id: string;
    role: string;
    text?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    createdAt: string;
    readAt?: string | null;
    staff?: { id: string; name: string; avatarUrl?: string | null } | null;
  };
  customerAvatar?: string;
  customerInitial?: string;
}

export default function MessageBubble({ message, customerAvatar, customerInitial }: MessageBubbleProps) {
  const isCustomer = message.role === 'CUSTOMER';
  const isBot = message.role === 'BOT';
  const isStaff = message.role === 'STAFF';
  const isSystem = message.role === 'SYSTEM' || message.role === 'AUTO_TRIGGER';

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[11px] text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
          {message.text}
        </span>
      </div>
    );
  }

  // GIF message — render as image, no bubble background
  const gifMatch = message.text?.match(/\[gif:(https?:\/\/[^\]]+)\]/);
  if (gifMatch) {
    const gifUrl = gifMatch[1];
    return (
      <div className={cn('flex gap-2 mb-3', isCustomer ? 'justify-start' : 'justify-end')}>
        {isCustomer && (
          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden shrink-0 mt-1">
            {customerAvatar ? (
              <img src={customerAvatar} alt={customerInitial ?? ''} className="w-full h-full object-cover" />
            ) : (
              <span className="text-gray-400 text-[10px] font-bold">{customerInitial ?? '?'}</span>
            )}
          </div>
        )}
        <div className="flex flex-col">
          <img
            src={gifUrl}
            alt="GIF"
            className="max-w-[200px] rounded-lg"
            loading="lazy"
          />
          <span className="flex items-center mt-1 px-1 self-end">
            <span className="text-[10px] text-gray-300">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            {isStaff && (
              <span className={cn('text-[10px] ml-1', message.readAt ? 'text-blue-400' : 'text-gray-400')}>
                {message.readAt ? '✓✓' : '✓'}
              </span>
            )}
          </span>
        </div>
      </div>
    );
  }

  // Sticker message — render as animated image, no bubble background
  const stickerMatch = message.text?.match(/\[sticker:(\d+):(\d+)\]/);
  if (stickerMatch) {
    const [, , stickerId] = stickerMatch;
    return (
      <div className={cn('flex gap-2 mb-3', isCustomer ? 'justify-start' : 'justify-end')}>
        {isCustomer && (
          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden shrink-0 mt-1">
            {customerAvatar ? (
              <img src={customerAvatar} alt={customerInitial ?? ''} className="w-full h-full object-cover" />
            ) : (
              <span className="text-gray-400 text-[10px] font-bold">{customerInitial ?? '?'}</span>
            )}
          </div>
        )}
        <div className="flex flex-col">
          <img
            src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker_animation.png`}
            onError={(e) => {
              (e.target as HTMLImageElement).src = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker@2x.png`;
            }}
            alt="sticker"
            className="w-[120px] h-[120px] object-contain"
          />
          <span className="flex items-center mt-1 px-1 self-end">
            <span className="text-[10px] text-gray-300">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            {isStaff && (
              <span className={cn('text-[10px] ml-1', message.readAt ? 'text-blue-400' : 'text-gray-400')}>
                {message.readAt ? '✓✓' : '✓'}
              </span>
            )}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-2 mb-3', isCustomer ? 'justify-start' : 'justify-end')}>
      {/* Customer avatar */}
      {isCustomer && (
        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden shrink-0 mt-1">
          {customerAvatar ? (
            <img src={customerAvatar} alt={customerInitial ?? ''} className="w-full h-full object-cover" />
          ) : (
            <span className="text-gray-400 text-[10px] font-bold">{customerInitial ?? '?'}</span>
          )}
        </div>
      )}
      {/* Staff avatar */}
      {isStaff && message.staff?.avatarUrl && (
        <img
          src={message.staff.avatarUrl}
          alt={message.staff.name}
          className="w-7 h-7 rounded-full object-cover flex-shrink-0 mt-1 order-first"
        />
      )}

      <div className={cn('max-w-[75%] flex flex-col', isCustomer ? 'items-start' : 'items-end')}>
        {/* Sender label */}
        {(isBot || isStaff) && (
          <span className="text-[10px] text-gray-400 mb-0.5 px-1">
            {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
          </span>
        )}

        {/* Bubble */}
        <div
          className={cn(
            'px-3.5 py-2 rounded-2xl text-sm leading-relaxed',
            isCustomer
              ? 'bg-gray-100 text-gray-900 rounded-bl-md'
              : isBot
                ? 'bg-purple-50 text-purple-900 rounded-br-md border border-purple-100'
                : 'bg-blue-500 text-white rounded-br-md',
          )}
        >
          {/* Media */}
          {message.mediaUrl && (
            <img
              src={message.mediaUrl}
              alt="media"
              className="max-w-full rounded-lg mb-1"
              loading="lazy"
            />
          )}

          {/* Text */}
          {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
        </div>

        {/* Timestamp + Read receipt */}
        <span className="flex items-center mt-0.5 px-1">
          <span className="text-[10px] text-gray-300">
            {format(new Date(message.createdAt), 'HH:mm')}
          </span>
          {message.role === 'STAFF' && (
            <span className={cn('text-[10px] ml-1', message.readAt ? 'text-blue-400' : 'text-gray-400')}>
              {message.readAt ? '✓✓' : '✓'}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

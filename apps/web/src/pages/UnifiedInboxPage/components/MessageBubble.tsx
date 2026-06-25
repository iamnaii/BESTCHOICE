import { useState } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { PaymentFlexPreview, parsePaymentFlex } from './PaymentFlexPreview';
import FlexBubblePreview from './FlexBubblePreview';
import { Check, CheckCheck, Lock, FileText, ImageOff, Download, Copy } from 'lucide-react';
import { linkifyText } from '@/lib/linkify';
import { toast } from 'sonner';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

/** In-chat image with a loading skeleton and a graceful error tile. */
function ChatImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground leading-snug"
      >
        <ImageOff className="size-4 shrink-0" /> โหลดรูปไม่ได้ — เปิดในแท็บใหม่
      </a>
    );
  }

  return (
    <div className={cn('relative mb-1', !loaded && 'min-h-30')}>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse rounded-lg bg-muted" aria-hidden />
      )}
      <img
        src={src}
        alt="media"
        className="max-w-60 max-h-75 rounded-lg cursor-zoom-in"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
        title="คลิกเพื่อดูรูปเต็ม"
      />
    </div>
  );
}

interface MessageBubbleProps {
  message: {
    id: string;
    role: string;
    type?: string | null;
    text?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    flexJson?: unknown;
    intent?: string | null;
    createdAt: string;
    readAt?: string | null;
    staff?: { id: string; name: string; avatarUrl?: string | null } | null;
  };
  customerAvatar?: string;
  customerInitial?: string;
}

/**
 * AI auto-reply indicator — chat-engine tags auto-sent bot messages with
 * intent prefix "AUTO:<route>" (see AiAutoReplyService). When present we
 * render a small 🤖 next to the timestamp so staff can tell at a glance
 * which messages were sent by AI vs. drafted-then-approved by a human.
 */
function AiAutoIndicator({ intent, role }: { intent?: string | null; role: string }) {
  if (role !== 'BOT' || !intent?.startsWith('AUTO:')) return null;
  return (
    <span
      className="ml-1 text-[10px] text-emerald-600"
      title="AI ตอบอัตโนมัติ"
      aria-label="AI ตอบอัตโนมัติ"
    >
      🤖
    </span>
  );
}

export default function MessageBubble({ message, customerAvatar, customerInitial }: MessageBubbleProps) {
  const isCustomer = message.role === 'CUSTOMER';
  const isBot = message.role === 'BOT';
  const isStaff = message.role === 'STAFF';
  const isSystem = message.role === 'SYSTEM' || message.role === 'AUTO_TRIGGER';

  const { copy } = useCopyToClipboard();
  const copyText = async () => {
    if (!message.text) return;
    const ok = await copy(message.text);
    ok ? toast.success('คัดลอกแล้ว') : toast.error('คัดลอกไม่สำเร็จ');
  };
  const canCopy = !!message.text && !/^\[(sticker|gif|flex):/.test(message.text);

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[11px] text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {message.text}
        </span>
      </div>
    );
  }

  // TEMPLATE message with structured Flex JSON — render full Flex preview
  if (message.type === 'TEMPLATE' && message.flexJson) {
    return (
      <div className={cn('flex gap-2 mb-3', isCustomer ? 'justify-start' : 'justify-end')}>
        <div className="flex flex-col max-w-[75%] items-end">
          {(isBot || isStaff) && (
            <span className="text-[10px] text-muted-foreground mb-0.5 px-1">
              {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
            </span>
          )}
          <FlexBubblePreview flex={message.flexJson} />
          <span className="flex items-center mt-0.5 px-1">
            <span className="text-[10px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
            {isStaff && (
              <span className={cn('text-[10px] ml-1', message.readAt ? 'text-primary' : 'text-muted-foreground')}>
                {message.readAt ? <CheckCheck className="size-3" /> : <Check className="size-3" />}
              </span>
            )}
          </span>
        </div>
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
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 mt-1">
            {customerAvatar ? (
              <img src={customerAvatar} alt={customerInitial ?? ''} className="w-full h-full object-cover" />
            ) : (
              <span className="text-muted-foreground text-[10px] font-bold">{customerInitial ?? '?'}</span>
            )}
          </div>
        )}
        <div className="flex flex-col">
          <img
            src={gifUrl}
            alt="GIF"
            className="max-w-[200px] max-h-60 rounded-lg"
            loading="lazy"
          />
          <span className="flex items-center mt-1 px-1 self-end">
            <span className="text-[10px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
            {isStaff && (
              <span className={cn('text-[10px] ml-1', message.readAt ? 'text-info' : 'text-muted-foreground')}>
                {message.readAt ? <CheckCheck className="size-3" /> : <Check className="size-3" />}
              </span>
            )}
          </span>
        </div>
      </div>
    );
  }

  // Payment Flex Card — preview the bubble customer received in LINE
  const paymentFlex = parsePaymentFlex(message.text);
  if (paymentFlex) {
    return (
      <div className={cn('flex gap-2 mb-3', isCustomer ? 'justify-start' : 'justify-end')}>
        <div className="flex flex-col max-w-[75%] items-end">
          {(isBot || isStaff) && (
            <span className="text-[10px] text-muted-foreground mb-0.5 px-1">
              {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
            </span>
          )}
          <PaymentFlexPreview data={paymentFlex} />
          <span className="flex items-center mt-0.5 px-1">
            <span className="text-[10px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
            {isStaff && (
              <span className={cn('text-[10px] ml-1', message.readAt ? 'text-primary' : 'text-muted-foreground')}>
                {message.readAt ? <CheckCheck className="size-3" /> : <Check className="size-3" />}
              </span>
            )}
          </span>
        </div>
      </div>
    );
  }

  // Flex verify card — render preview mimicking the LINE Flex bubble
  if (message.text === '[flex:verify]') {
    return (
      <div className={cn('flex gap-2 mb-3', isCustomer ? 'justify-start' : 'justify-end')}>
        <div className="flex flex-col max-w-[75%] items-end">
          {(isBot || isStaff) && (
            <span className="text-[10px] text-muted-foreground mb-0.5 px-1">
              {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
            </span>
          )}
          <div className="w-[240px] rounded-2xl overflow-hidden border border-border bg-card shadow-sm">
            <div className="bg-primary px-3.5 py-2 text-primary-foreground">
              <div className="text-[10px] opacity-90 leading-snug">BEST CHOICE FINANCE</div>
              <div className="text-sm font-semibold leading-snug mt-0.5"><Lock className="size-4 inline" /> ยืนยันตัวตน</div>
            </div>
            <div className="px-3.5 py-3 text-sm text-foreground leading-snug">
              รบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ
            </div>
            <div className="px-3.5 pb-3">
              <div className="w-full text-center text-xs font-medium py-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
                ยืนยันตัวตน
              </div>
            </div>
            <div className="px-3.5 py-1.5 bg-muted/50 border-t border-border">
              <span className="text-[9px] text-muted-foreground">Flex Message</span>
            </div>
          </div>
          <span className="flex items-center mt-0.5 px-1">
            <span className="text-[10px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
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
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 mt-1">
            {customerAvatar ? (
              <img src={customerAvatar} alt={customerInitial ?? ''} className="w-full h-full object-cover" />
            ) : (
              <span className="text-muted-foreground text-[10px] font-bold">{customerInitial ?? '?'}</span>
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
            <span className="text-[10px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
            {isStaff && (
              <span className={cn('text-[10px] ml-1', message.readAt ? 'text-info' : 'text-muted-foreground')}>
                {message.readAt ? <CheckCheck className="size-3" /> : <Check className="size-3" />}
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
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 mt-1">
          {customerAvatar ? (
            <img src={customerAvatar} alt={customerInitial ?? ''} className="w-full h-full object-cover" />
          ) : (
            <span className="text-muted-foreground text-[10px] font-bold">{customerInitial ?? '?'}</span>
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

      <div className={cn('group relative max-w-[75%] flex flex-col', isCustomer ? 'items-start' : 'items-end')}>
        {/* Sender label */}
        {(isBot || isStaff) && (
          <span className="text-[10px] text-muted-foreground mb-0.5 px-1">
            {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
          </span>
        )}

        {/* Bubble */}
        <div
          className={cn(
            'relative max-w-full min-w-0 px-3.5 py-2 rounded-2xl text-sm leading-relaxed [overflow-wrap:anywhere]',
            isCustomer
              ? 'bg-muted text-foreground rounded-bl-md'
              : isBot
                ? 'bg-muted text-foreground rounded-br-md border border-border'
                : 'bg-primary text-primary-foreground rounded-br-md',
          )}
        >
          {/* Copy button — floats at the outer corner of the bubble, visible on hover */}
          {canCopy && (
            <button
              type="button"
              onClick={copyText}
              title="คัดลอกข้อความ"
              aria-label="คัดลอกข้อความ"
              className={cn(
                'absolute top-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity',
                'rounded-md border border-border bg-card p-1 text-muted-foreground shadow-sm hover:text-foreground',
                isCustomer ? '-right-7' : '-left-7',
              )}
            >
              <Copy className="size-3.5" />
            </button>
          )}

          {/* Media — render by type: FILE/non-image → file tile; image → ChatImage skeleton */}
          {message.mediaUrl &&
            ((message.type === 'FILE' ||
            (message.mediaType && !message.mediaType.startsWith('image/'))) ? (
              <a
                href={message.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-1 flex items-center gap-2 rounded-lg bg-background/60 border border-border px-3 py-2 text-xs"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate max-w-44">{message.text || 'ไฟล์แนบ'}</span>
                <Download className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            ) : (
              <ChatImage src={message.mediaUrl} />
            ))}

          {/* Text — skip when the message is a FILE/non-image so the filename
              from message.text isn't duplicated below the file tile above. */}
          {/* linkify is safe here: only the final fallback branch reaches this — gif/
              sticker/flex tokens early-return above, so [token:…] never gets linkified */}
          {message.text &&
            !(
              message.type === 'FILE' ||
              (message.mediaType && !message.mediaType.startsWith('image/'))
            ) && <p className="whitespace-pre-wrap">{linkifyText(message.text)}</p>}
        </div>

        {/* Timestamp + Read receipt */}
        <span className="flex items-center mt-0.5 px-1">
          <span className="text-[10px] text-muted-foreground">
            {format(new Date(message.createdAt), 'HH:mm')}
          </span>
          <AiAutoIndicator intent={message.intent} role={message.role} />
          {message.role === 'STAFF' && (
            <span className={cn('text-[10px] ml-1', message.readAt ? 'text-primary' : 'text-muted-foreground')}>
              {message.readAt ? <CheckCheck className="size-3" /> : <Check className="size-3" />}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

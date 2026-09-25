import { memo, useState } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { PaymentFlexPreview, parsePaymentFlex } from './PaymentFlexPreview';
import FlexBubblePreview from './FlexBubblePreview';
import { Check, CheckCheck, Lock, FileText, ImageOff, Download, Copy, ShieldCheck, AlertCircle, Landmark } from 'lucide-react';
import { CREDIT_MESSAGE_MIME } from './credit-statement';
import { GFIN_MESSAGE_MIME, isGfinPickable } from './gfin/gfin';
import { linkifyText } from '@/lib/linkify';
import { toast } from 'sonner';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { ImageLightbox } from '@/components/ImageLightbox';

/** In-chat image with a loading skeleton and a graceful error tile. */
function ChatImage({ src, onLoadError }: { src: string; onLoadError?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

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
        onError={() => { setErrored(true); onLoadError?.(); }}
        onClick={() => setLightboxSrc(src)}
        title="คลิกเพื่อดูรูปเต็ม"
      />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}

interface MessageBubbleProps {
  onCreditMessage?: (messageId: string) => void;
  creditAttached?: boolean;
  creditBusy?: boolean;
  onGfinMessage?: (messageId: string) => void;
  gfinAttached?: boolean;
  gfinBusy?: boolean;
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
    /** id ของข้อความบนช่องทางต้นทาง (เช่น LINE) — ห้อง LINE เก่าบางข้อความไม่มี `mediaUrl`
     * เก็บไว้ในระบบเราแต่ยังหยิบเข้าใบยื่น GFIN ได้ผ่าน id นี้ (`isGfinPickable`) */
    externalMessageId?: string | null;
    /**
     * เวลาที่ส่งออกถึงช่องทางสำเร็จ (`markOutboundSent` — message-router.service.ts:972)
     * null + มี `staff` = เรากดส่งแล้วไม่ถึงลูกค้า · null + ไม่มี `staff` = echo จากแอป Facebook
     * ซึ่งเราไม่ได้เป็นคนส่ง จึงไม่ใช่ความล้มเหลว (prod มี echo แบบนี้ 72,900+ ใบ)
     */
    outboundSentAt?: string | null;
    staff?: { id: string; name: string; avatarUrl?: string | null } | null;
  };
  customerAvatar?: string;
  customerInitial?: string;
}

type DeliveryMessage = {
  role: string;
  readAt?: string | null;
  outboundSentAt?: string | null;
  staff?: { id: string } | null;
};

/**
 * สถานะการส่งของข้อความฝั่งพนักงาน
 *
 * เดิมโชว์เครื่องหมายถูกเสมอ แม้ส่งไม่ถึงลูกค้า (ฟองแดงเป็นแค่ state ชั่วคราวใน
 * หน้าจอของคนส่ง หายทันทีที่รีเฟรช) ⇒ เพื่อนร่วมทีมเปิดห้องมาเห็นว่า "ตอบแล้ว"
 * ทั้งที่ลูกค้าไม่ได้รับอะไรเลย · อ่านจาก `outboundSentAt` จึงอยู่ข้ามการรีเฟรช
 *
 * ข้อความที่พนักงานตอบจากแอป Facebook (echo) ไม่มี `staff` และไม่มี `outboundSentAt`
 * ต้องไม่ถูกตีเป็นล้มเหลว ไม่งั้นทั้งกล่องจะแดงทั้งหมด
 */
function DeliveryMark({ message, readColor }: { message: DeliveryMessage; readColor: string }) {
  if (message.role !== 'STAFF') return null;
  const sentFromInbox = !!message.staff?.id;
  if (sentFromInbox && !message.outboundSentAt) {
    return (
      <span
        className="text-[10px] ml-1 text-destructive inline-flex items-center gap-0.5"
        title="ยังไม่ถึงลูกค้า — กดส่งใหม่อีกครั้ง"
      >
        <AlertCircle className="size-3" />
        ยังไม่ถึงลูกค้า
      </span>
    );
  }
  return (
    <span className={cn('text-[10px] ml-1', message.readAt ? readColor : 'text-muted-foreground')}>
      {message.readAt ? <CheckCheck className="size-3" /> : <Check className="size-3" />}
    </span>
  );
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

function MessageBubble({ message, customerAvatar, customerInitial, onCreditMessage, creditAttached, creditBusy, onGfinMessage, gfinAttached, gfinBusy }: MessageBubbleProps) {
  const [failedMediaUrl, setFailedMediaUrl] = useState<string | null>(null);
  const mediaBroken = !!message.mediaUrl && failedMediaUrl === message.mediaUrl;
  const canCredit = !!onCreditMessage && !!message.mediaUrl && (message.type === 'IMAGE' || message.type === 'FILE');
  const canGfin = !!onGfinMessage && isGfinPickable(message);
  const isCustomer = message.role === 'CUSTOMER';
  const isBot = message.role === 'BOT';
  const isStaff = message.role === 'STAFF';
  const isSystem = message.role === 'SYSTEM' || message.role === 'AUTO_TRIGGER';

  const { copy } = useCopyToClipboard();
  const copyText = async () => {
    if (!message.text) return;
    const ok = await copy(message.text);
    if (ok) toast.success('คัดลอกแล้ว');
    else toast.error('คัดลอกไม่สำเร็จ');
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
            <span className="text-[11px] text-muted-foreground mb-0.5 px-1">
              {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
            </span>
          )}
          <FlexBubblePreview flex={message.flexJson} />
          <span className="flex items-center mt-0.5 px-1">
            <span className="text-[11px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
            <DeliveryMark message={message} readColor="text-primary" />
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
            <span className="text-[11px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
            <DeliveryMark message={message} readColor="text-info" />
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
            <span className="text-[11px] text-muted-foreground mb-0.5 px-1">
              {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
            </span>
          )}
          <PaymentFlexPreview data={paymentFlex} />
          <span className="flex items-center mt-0.5 px-1">
            <span className="text-[11px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
            <DeliveryMark message={message} readColor="text-primary" />
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
            <span className="text-[11px] text-muted-foreground mb-0.5 px-1">
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
            <span className="text-[11px] text-muted-foreground">
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
            <span className="text-[11px] text-muted-foreground">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
            <AiAutoIndicator intent={message.intent} role={message.role} />
            <DeliveryMark message={message} readColor="text-info" />
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
          <span className="text-[11px] text-muted-foreground mb-0.5 px-1">
            {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
          </span>
        )}

        {/* Bubble */}
        <div
          draggable={(canCredit || canGfin) && !mediaBroken && !creditBusy && !gfinBusy}
          onDragStart={event => {
            if ((!canCredit && !canGfin) || mediaBroken || creditBusy || gfinBusy) { event.preventDefault(); return; }
            event.stopPropagation();
            event.dataTransfer.clearData();
            if (canCredit) event.dataTransfer.setData(CREDIT_MESSAGE_MIME, message.id);
            if (canGfin) event.dataTransfer.setData(GFIN_MESSAGE_MIME, message.id);
            event.dataTransfer.effectAllowed = 'copy';
          }}
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
                'absolute top-1 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 transition-opacity',
                'rounded-md border border-border bg-card p-1 text-muted-foreground shadow-sm hover:text-foreground',
                isCustomer ? '-right-7' : '-left-7',
              )}
            >
              <Copy className="size-3.5" />
            </button>
          )}

          {/* Media — render by type: FILE/non-image → file tile; image → ChatImage skeleton */}
          {canCredit && <button type="button"
            aria-label={mediaBroken ? 'โหลดไฟล์ไม่ได้ กรุณาขอไฟล์ใหม่' : creditAttached ? 'เอาออกจากการตรวจเครดิต' : 'แนบเพื่อตรวจเครดิต'}
            title={mediaBroken ? 'ไฟล์อาจหมดอายุ กรุณาขอไฟล์ใหม่' : creditAttached ? 'แนบแล้ว · กดเพื่อเอาออก' : 'แนบเพื่อตรวจเครดิต · ลูกค้าไม่เห็น'}
            disabled={mediaBroken || creditBusy}
            onClick={event => { event.stopPropagation(); onCreditMessage?.(message.id); }}
            className={cn('absolute flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed', canCopy ? 'top-8' : 'top-1', isCustomer ? '-right-12' : '-left-12', creditAttached ? 'text-primary opacity-100' : 'opacity-0')}>
            {creditAttached ? <Check className="size-4" /> : <ShieldCheck className="size-4" />}
          </button>}
          {canGfin && <button type="button"
            aria-label={gfinAttached ? 'เอาออกจากใบยื่น GFIN' : 'ใส่ในใบยื่น GFIN'}
            title={mediaBroken ? 'ไฟล์อาจหมดอายุ กรุณาขอไฟล์ใหม่' : gfinAttached ? 'อยู่ในใบยื่นแล้ว · กดเพื่อเอาออก' : 'ใส่ในใบยื่น GFIN · ลูกค้าไม่เห็น'}
            disabled={mediaBroken || gfinBusy}
            onClick={event => { event.stopPropagation(); onGfinMessage?.(message.id); }}
            className={cn('absolute flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed',
              canCredit ? (canCopy ? 'top-20' : 'top-13') : (canCopy ? 'top-8' : 'top-1'), isCustomer ? '-right-12' : '-left-12', gfinAttached ? 'text-primary opacity-100' : 'opacity-0')}>
            {gfinAttached ? <Check className="size-4" /> : <Landmark className="size-4" />}
          </button>}
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
              <ChatImage key={message.mediaUrl} src={message.mediaUrl} onLoadError={() => setFailedMediaUrl(message.mediaUrl!)} />
            ))}

          {/* FILE ที่ระบบไม่ได้เก็บไฟล์ไว้ (webhook LINE ไฟแนนซ์บันทึกแค่ message id — ไม่มี mediaUrl) — เดิมเป็นฟองว่าง
              ปุ่ม GFIN ข้างบนยังหยิบได้ผ่าน externalMessageId (minor 11) */}
          {!message.mediaUrl && message.type === 'FILE' && (
            <span className="mb-1 flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="max-w-44 truncate">{message.text ? `[ไฟล์] ${message.text}` : '[ไฟล์]'}</span>
            </span>
          )}

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
          <DeliveryMark message={message} readColor="text-primary" />
        </span>
      </div>
    </div>
  );
}

export default memo(MessageBubble);

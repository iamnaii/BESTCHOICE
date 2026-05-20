import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { PaymentFlexPreview, parsePaymentFlex } from './PaymentFlexPreview';
import FlexBubblePreview from './FlexBubblePreview';
import { Check, CheckCheck, Lock } from 'lucide-react';

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
            className="max-w-[200px] rounded-lg"
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

      <div className={cn('max-w-[75%] flex flex-col', isCustomer ? 'items-start' : 'items-end')}>
        {/* Sender label */}
        {(isBot || isStaff) && (
          <span className="text-[10px] text-muted-foreground mb-0.5 px-1">
            {isBot ? 'Bot' : message.staff?.name ?? 'พนักงาน'}
          </span>
        )}

        {/* Bubble */}
        <div
          className={cn(
            'max-w-full min-w-0 px-3.5 py-2 rounded-2xl text-sm leading-relaxed [overflow-wrap:anywhere]',
            isCustomer
              ? 'bg-muted text-foreground rounded-bl-md'
              : isBot
                ? 'bg-muted text-foreground rounded-br-md border border-border'
                : 'bg-primary text-primary-foreground rounded-br-md',
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
          {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
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

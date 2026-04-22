import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export interface Message {
  id: string;
  role: 'CUSTOMER' | 'STAFF' | 'BOT' | 'AUTO_TRIGGER' | 'SYSTEM';
  text: string | null;
  createdAt: string;
  intent?: string | null;
  confidence?: number | null;
  toolsUsed?: string[];
  deliveredAt?: string | null;
}

/**
 * MessageBubble — one row in the conversation panel.
 *
 * - CUSTOMER messages render on the left with a muted background.
 * - STAFF/BOT/SYSTEM messages render on the right.
 * - BOT messages flagged as AI drafts (intent starts with `DRAFT:` and not yet
 *   delivered) are visually distinguished with an emerald left border so
 *   reviewers can quickly spot pending-approval replies.
 */
export function MessageBubble({ message }: { message: Message }) {
  const isCustomer = message.role === 'CUSTOMER';
  const isSystem = message.role === 'SYSTEM' || message.role === 'AUTO_TRIGGER';
  const isDraft = !!message.intent?.startsWith('DRAFT:') && !message.deliveredAt;

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-xs leading-snug text-muted-foreground">
          {message.text ?? ''}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex', isCustomer ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-2 text-sm leading-snug whitespace-pre-wrap break-words',
          isCustomer
            ? 'bg-muted text-foreground'
            : 'bg-primary text-primary-foreground',
          isDraft && 'border-l-4 border-emerald-500 bg-card text-foreground',
        )}
      >
        <div>{message.text ?? ''}</div>
        {message.role === 'BOT' && (
          <div className="mt-1 flex items-center gap-1 text-[10px] leading-snug opacity-70">
            <span>AI</span>
            {isDraft && (
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                Draft
              </Badge>
            )}
            {typeof message.confidence === 'number' && (
              <span>· {(message.confidence * 100).toFixed(0)}%</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

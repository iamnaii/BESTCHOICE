import { FlexPreviewCard } from '@/components/line-message/FlexPreviewCard';
export { FlexPreviewCard } from '@/components/line-message/FlexPreviewCard';
import { Video } from 'lucide-react';

import {
  type TextContent,
  type ImageContent,
  type VideoContent,
  type FlexContent,
  type RichContent,
  type MessageItem,
} from './message';
interface MessagePreviewBubbleProps {
  message: MessageItem;
}

export function MessagePreviewBubble({ message }: MessagePreviewBubbleProps) {
  if (message.type === 'text') {
    const c = message.content as TextContent;
    return (
      <div className="bg-card rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-[85%] shadow-sm">
        <p className="whitespace-pre-wrap text-foreground/90 text-xs leading-relaxed">
          {c.text || <span className="text-muted-foreground">ข้อความจะแสดงที่นี่...</span>}
        </p>
      </div>
    );
  }

  if (message.type === 'image') {
    const c = message.content as ImageContent;
    return (
      <div className="bg-card rounded-2xl rounded-tl-sm overflow-hidden max-w-[85%] shadow-sm">
        {c.imagePreview ? (
          <img src={c.imagePreview} alt="preview" className="max-w-full rounded-t-2xl" />
        ) : (
          <div className="flex h-20 items-center justify-center bg-muted text-xs text-muted-foreground">
            รูปภาพจะแสดงที่นี่
          </div>
        )}
        {c.caption && <p className="px-3 py-1.5 text-xs text-foreground/70">{c.caption}</p>}
      </div>
    );
  }

  if (message.type === 'video') {
    const c = message.content as VideoContent;
    return (
      <div className="bg-card rounded-2xl rounded-tl-sm overflow-hidden max-w-[85%] shadow-sm">
        {c.thumbnailPreview ? (
          <div className="relative">
            <img src={c.thumbnailPreview} alt="thumbnail" className="max-w-full" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                <Video className="size-5 text-white" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center bg-muted text-xs text-muted-foreground gap-2">
            <Video className="size-4" />
            วิดีโอจะแสดงที่นี่
          </div>
        )}
      </div>
    );
  }

  if (message.type === 'flex') {
    const c = message.content as FlexContent;
    return <FlexPreviewCard content={c} />;
  }

  if (message.type === 'rich') {
    const c = message.content as RichContent;
    return (
      <div className="bg-card rounded-2xl rounded-tl-sm overflow-hidden max-w-[85%] shadow-sm">
        {c.imagePreview ? (
          <img src={c.imagePreview} alt="rich" className="max-w-full" />
        ) : (
          <div className="flex h-20 items-center justify-center bg-muted text-xs text-muted-foreground">
            Rich Message
          </div>
        )}
      </div>
    );
  }

  return null;
}

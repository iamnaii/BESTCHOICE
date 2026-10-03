import type { BroadcastHistoryRecord } from './api-contract';

// Review every visible text and destination, including nested Flex/carousel items.
function flexDetails(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flexDetails);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    ['text', 'label', 'url', 'uri'].includes(key) && typeof child === 'string'
      ? [child]
      : flexDetails(child),
  );
}
export function BroadcastMessageReview({
  messages,
}: {
  messages: BroadcastHistoryRecord['messages'];
}) {
  return (
    <div className="max-h-[50vh] space-y-4 overflow-y-auto">
      {messages.map((message, index) => {
        const content =
          typeof message.content === 'string' ? { text: message.content } : message.content;
        const image = content.imageUrl ?? content.originalContentUrl;
        const video = content.videoUrl ?? content.originalContentUrl;
        const thumbnail = content.thumbnailUrl ?? content.previewImageUrl;
        return (
          <div key={index} className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="font-medium">ข้อความที่ {index + 1}</p>
            {message.type === 'text' && (
              <p className="whitespace-pre-wrap break-words">{String(content.text ?? '')}</p>
            )}
            {['image', 'rich'].includes(message.type) && typeof image === 'string' && (
              <img
                src={image}
                alt={`รูปข้อความที่ ${index + 1}`}
                className="max-h-64 object-contain"
              />
            )}
            {message.type === 'video' && typeof video === 'string' && (
              <video
                controls
                preload="metadata"
                src={video}
                poster={typeof thumbnail === 'string' ? thumbnail : undefined}
                className="max-h-64 w-full"
              />
            )}
            {typeof content.caption === 'string' && (
              <p className="whitespace-pre-wrap">{content.caption}</p>
            )}
            {message.type === 'rich' && typeof content.linkUrl === 'string' && (
              <p className="break-all">ลิงก์: {content.linkUrl}</p>
            )}
            {message.type === 'flex' &&
              flexDetails(content.flexContents ?? content.contents ?? content).map((text, i) => (
                <p className="whitespace-pre-wrap break-all" key={i}>
                  {text}
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}

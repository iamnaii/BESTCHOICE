import TextBubbleEditor from './bubble-editors/TextBubbleEditor';
import ImageBubbleEditor from './bubble-editors/ImageBubbleEditor';
import StickerBubbleEditor from './bubble-editors/StickerBubbleEditor';
import type { CannedResponseBubble } from './types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function BubbleEditor({ bubble, onChange }: Props) {
  switch (bubble.type) {
    case 'TEXT':
      return <TextBubbleEditor bubble={bubble} onChange={onChange} />;
    case 'IMAGE':
      return <ImageBubbleEditor bubble={bubble} onChange={onChange} />;
    case 'STICKER':
      return <StickerBubbleEditor bubble={bubble} onChange={onChange} />;
    default:
      return <div className="text-sm text-muted-foreground">ไม่รองรับ type นี้ใน Phase 1</div>;
  }
}

import TextBubbleEditor from './bubble-editors/TextBubbleEditor';
import ImageBubbleEditor from './bubble-editors/ImageBubbleEditor';
import StickerBubbleEditor from './bubble-editors/StickerBubbleEditor';
import CardBubbleEditor from './bubble-editors/CardBubbleEditor';
import LocationBubbleEditor from './bubble-editors/LocationBubbleEditor';
import VideoBubbleEditor from './bubble-editors/VideoBubbleEditor';
import JsonBubbleEditor from './bubble-editors/JsonBubbleEditor';
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
    case 'CARD':
      return <CardBubbleEditor bubble={bubble} onChange={onChange} />;
    case 'LOCATION':
      return <LocationBubbleEditor bubble={bubble} onChange={onChange} />;
    case 'VIDEO':
      return <VideoBubbleEditor bubble={bubble} onChange={onChange} />;
    case 'JSON':
      return <JsonBubbleEditor bubble={bubble} onChange={onChange} />;
    default:
      return <div className="text-sm text-muted-foreground">ไม่รองรับ type นี้</div>;
  }
}

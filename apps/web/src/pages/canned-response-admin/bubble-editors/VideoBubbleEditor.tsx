import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CannedResponseBubble } from '../types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function VideoBubbleEditor({ bubble, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor="vid-url" className="text-xs">URL วิดีโอ (mp4)</Label>
        <Input id="vid-url" value={bubble.mediaUrl ?? ''} onChange={(e) => onChange({ mediaUrl: e.target.value })} placeholder="https://.../video.mp4" />
      </div>
      <div>
        <Label htmlFor="vid-thumb" className="text-xs">URL รูปปก (preview)</Label>
        <Input id="vid-thumb" value={bubble.thumbnailUrl ?? ''} onChange={(e) => onChange({ thumbnailUrl: e.target.value })} placeholder="https://.../thumb.jpg" />
      </div>
      {bubble.mediaUrl && (
        <video src={bubble.mediaUrl} poster={bubble.thumbnailUrl ?? undefined} controls className="max-w-xs max-h-48 rounded border border-border" />
      )}
      <p className="text-xs text-muted-foreground leading-snug">
        ใช้ video URL ที่ public — LINE ต้องเป็น HTTPS + mp4 ≤ 200MB ≤ 1 นาที
        <br />
        รูปปก (preview) ต้องระบุเสมอเป็น JPEG/PNG — LINE จะ reject ถ้าไม่มี
      </p>
    </div>
  );
}

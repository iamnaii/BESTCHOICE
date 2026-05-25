import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CannedResponseBubble } from '../types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function StickerBubbleEditor({ bubble, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="package-id" className="text-xs">Package ID</Label>
          <Input
            id="package-id"
            value={bubble.stickerPackageId ?? ''}
            onChange={(e) => onChange({ stickerPackageId: e.target.value })}
            placeholder="11537"
          />
        </div>
        <div>
          <Label htmlFor="sticker-id" className="text-xs">Sticker ID</Label>
          <Input
            id="sticker-id"
            value={bubble.stickerId ?? ''}
            onChange={(e) => onChange({ stickerId: e.target.value })}
            placeholder="52002734"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">
        ดู ID ได้ที่{' '}
        <a href="https://developers.line.biz/en/docs/messaging-api/sticker-list/" target="_blank" rel="noreferrer" className="text-primary hover:underline">
          LINE Sticker docs
        </a>
        {' '}(สำหรับ LINE channel เท่านั้น)
      </p>
      {bubble.stickerPackageId && bubble.stickerId && (
        <img
          src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${bubble.stickerId}/android/sticker.png`}
          alt="sticker preview"
          className="w-24 h-24 border border-border rounded"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
    </div>
  );
}

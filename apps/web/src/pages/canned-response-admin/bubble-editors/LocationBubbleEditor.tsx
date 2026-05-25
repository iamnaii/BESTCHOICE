import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CannedResponseBubble } from '../types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function LocationBubbleEditor({ bubble, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor="loc-title" className="text-xs">ชื่อสถานที่</Label>
        <Input id="loc-title" value={bubble.locationTitle ?? ''} onChange={(e) => onChange({ locationTitle: e.target.value })} placeholder="เช่น สาขาลาดพร้าว" />
      </div>
      <div>
        <Label htmlFor="loc-address" className="text-xs">ที่อยู่</Label>
        <Input id="loc-address" value={bubble.address ?? ''} onChange={(e) => onChange({ address: e.target.value })} placeholder="ที่อยู่เต็ม" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="lat" className="text-xs">Latitude</Label>
          <Input id="lat" type="number" step="any" value={bubble.latitude ?? ''} onChange={(e) => onChange({ latitude: e.target.value ? parseFloat(e.target.value) : null })} placeholder="13.7563" />
        </div>
        <div>
          <Label htmlFor="lng" className="text-xs">Longitude</Label>
          <Input id="lng" type="number" step="any" value={bubble.longitude ?? ''} onChange={(e) => onChange({ longitude: e.target.value ? parseFloat(e.target.value) : null })} placeholder="100.5018" />
        </div>
      </div>
      {bubble.latitude && bubble.longitude && (
        <a href={`https://www.google.com/maps?q=${bubble.latitude},${bubble.longitude}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
          ดูใน Google Maps →
        </a>
      )}
    </div>
  );
}

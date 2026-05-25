import { useState, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { CannedResponseBubble } from '../types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function JsonBubbleEditor({ bubble, onChange }: Props) {
  const [draft, setDraft] = useState(() => JSON.stringify(bubble.json ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(JSON.stringify(bubble.json ?? {}, null, 2));
  }, [bubble.id]);

  const handleBlur = () => {
    try {
      const parsed = JSON.parse(draft);
      setError(null);
      onChange({ json: parsed });
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="json-raw" className="text-xs">JSON (LINE Flex / FB structured message)</Label>
      <Textarea
        id="json-raw"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        className="font-mono text-[11px] min-h-[200px] leading-snug"
        spellCheck={false}
      />
      {error && <p className="text-xs text-destructive">JSON ผิด syntax: {error}</p>}
      <p className="text-xs text-muted-foreground leading-snug">
        Raw mode — สำหรับ LINE Flex Bubble / Carousel หรือ FB Generic Template. ระบบจะส่งตรงไปยัง channel API. JSON parse บน blur — เปลี่ยน focus ออกก่อนเพื่อ save.
      </p>
    </div>
  );
}

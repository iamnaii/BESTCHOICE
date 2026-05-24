import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2 } from 'lucide-react';
import type { CannedResponseBubble } from '../types';

interface CardData {
  heroImageUrl?: string;
  title?: string;
  subtitle?: string;
  buttons?: Array<{ label: string; type: 'URL' | 'MESSAGE' | 'POSTBACK'; value: string }>;
}

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function CardBubbleEditor({ bubble, onChange }: Props) {
  const data: CardData = (bubble.json as CardData) ?? {};
  const buttons = data.buttons ?? [];

  const updateData = (patch: Partial<CardData>) => {
    onChange({ json: { ...data, ...patch } });
  };

  const addButton = () => {
    if (buttons.length >= 3) return;
    updateData({ buttons: [...buttons, { label: 'ปุ่มใหม่', type: 'MESSAGE', value: '' }] });
  };

  const updateButton = (idx: number, patch: Partial<NonNullable<CardData['buttons']>[number]>) => {
    const next = [...buttons];
    next[idx] = { ...next[idx], ...patch };
    updateData({ buttons: next });
  };

  const removeButton = (idx: number) => {
    updateData({ buttons: buttons.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="hero" className="text-xs">URL รูปหัวการ์ด</Label>
        <Input id="hero" value={data.heroImageUrl ?? ''} onChange={(e) => updateData({ heroImageUrl: e.target.value })} placeholder="https://..." />
        {data.heroImageUrl && (
          <img src={data.heroImageUrl} alt="hero" className="mt-2 max-w-xs max-h-32 rounded border border-border" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="card-title" className="text-xs">หัวเรื่อง</Label>
          <Input id="card-title" value={data.title ?? ''} onChange={(e) => updateData({ title: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="card-sub" className="text-xs">คำอธิบาย</Label>
          <Input id="card-sub" value={data.subtitle ?? ''} onChange={(e) => updateData({ subtitle: e.target.value })} />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">ปุ่ม ({buttons.length}/3)</Label>
          <Button size="sm" variant="outline" onClick={addButton} disabled={buttons.length >= 3}>
            <Plus className="w-3 h-3 mr-1" /> เพิ่มปุ่ม
          </Button>
        </div>
        <div className="space-y-1.5">
          {buttons.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5 border border-border rounded p-2">
              <Input value={b.label} onChange={(e) => updateButton(i, { label: e.target.value })} placeholder="ป้ายปุ่ม" className="flex-1 text-xs" />
              <select value={b.type} onChange={(e) => updateButton(i, { type: e.target.value as 'URL' | 'MESSAGE' | 'POSTBACK' })} className="text-xs border border-border rounded px-1.5 py-1 bg-background">
                <option value="MESSAGE">Msg</option>
                <option value="URL">URL</option>
                <option value="POSTBACK">Postback</option>
              </select>
              <Input value={b.value} onChange={(e) => updateButton(i, { value: e.target.value })} placeholder={b.type === 'URL' ? 'https://...' : 'value'} className="flex-1 text-xs font-mono" />
              <button onClick={() => removeButton(i)} className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">ดู Flex JSON ที่จะถูกส่ง</summary>
        <Textarea value={JSON.stringify(data, null, 2)} readOnly className="mt-1 font-mono text-[10px] min-h-[80px] bg-muted/30" />
      </details>
    </div>
  );
}

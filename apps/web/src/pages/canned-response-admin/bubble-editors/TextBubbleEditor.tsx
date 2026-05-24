import { Textarea } from '@/components/ui/textarea';
import type { CannedResponseBubble } from '../types';

const VARIABLES = ['{customerName}', '{customerPhone}', '{contractNumber}', '{amountDue}', '{dueDate}', '{installmentNo}', '{branchName}'];

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function TextBubbleEditor({ bubble, onChange }: Props) {
  return (
    <div className="space-y-2">
      <Textarea
        value={bubble.text ?? ''}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="พิมพ์ข้อความ..."
        className="min-h-[120px] text-sm leading-relaxed"
      />
      <div className="flex flex-wrap gap-1">
        {VARIABLES.map((v) => (
          <button
            key={v}
            onClick={() => onChange({ text: (bubble.text ?? '') + v })}
            className="px-2 py-0.5 text-[11px] font-mono bg-muted hover:bg-emerald-50 hover:text-emerald-700 rounded border border-border"
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import type { Message } from './MessageBubble';
import { useApproveDraft, useSkipDraft } from '../hooks/useAiDraft';

/**
 * AiDraftCard — surfaces a pending AI draft reply with Approve / Edit / Skip.
 *
 * Approve: sends the (possibly edited) text as the room's next staff reply
 * and marks the draft as delivered.
 * Edit: toggles an inline textarea; approve then uses the edited copy.
 * Skip: discards the draft — AI will generate a new one on the next inbound.
 */
export function AiDraftCard({ draft, roomId }: { draft: Message; roomId: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.text ?? '');
  const approve = useApproveDraft();
  const skip = useSkipDraft();

  // Reset local edit state when the underlying draft changes.
  useEffect(() => {
    setText(draft.text ?? '');
    setEditing(false);
  }, [draft.id, draft.text]);

  const handleApprove = () => {
    const edited = editing ? text.trim() : undefined;
    if (editing && !edited) {
      toast.error('ข้อความว่างเปล่า');
      return;
    }
    approve.mutate(
      { draftMessageId: draft.id, editedText: edited, roomId },
      {
        onSuccess: () => {
          toast.success('ส่งให้ลูกค้าแล้ว');
          setEditing(false);
        },
        onError: () => toast.error('ส่งไม่สำเร็จ'),
      },
    );
  };

  const handleSkip = () => {
    skip.mutate(
      { draftMessageId: draft.id, roomId },
      {
        onSuccess: () => toast.success('ข้ามร่างนี้แล้ว'),
        onError: () => toast.error('ข้ามไม่สำเร็จ'),
      },
    );
  };

  const intentLabel = draft.intent?.startsWith('DRAFT:')
    ? draft.intent.slice('DRAFT:'.length)
    : draft.intent;

  return (
    <Card className="border-l-4 border-l-emerald-500">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm leading-snug">
          <span>AI แนะนำคำตอบ</span>
          {intentLabel && (
            <Badge variant="outline" className="text-[10px] leading-snug">
              {intentLabel}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {editing ? (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[90px] text-sm leading-snug"
            aria-label="แก้ไขข้อความก่อนส่ง"
          />
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
            {draft.text ?? ''}
          </div>
        )}
        <div className="text-xs leading-snug text-muted-foreground">
          {draft.toolsUsed && draft.toolsUsed.length > 0
            ? `Tools: ${draft.toolsUsed.join(', ')}`
            : 'ไม่ได้เรียก tool'}
          {typeof draft.confidence === 'number' && (
            <span> · ความมั่นใจ {(draft.confidence * 100).toFixed(0)}%</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={approve.isPending || skip.isPending}
          >
            <Check className="mr-1 h-3 w-3" />
            ส่ง
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing((prev) => !prev)}
            disabled={approve.isPending || skip.isPending}
          >
            <Pencil className="mr-1 h-3 w-3" />
            {editing ? 'ยกเลิกแก้' : 'แก้ก่อนส่ง'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSkip}
            disabled={approve.isPending || skip.isPending}
          >
            <X className="mr-1 h-3 w-3" />
            ข้าม
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

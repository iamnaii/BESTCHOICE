import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { JOURNEY_LOST_REASON_LABELS, type JourneySummary } from '@installment/shared';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { getCompanyScopeRevision } from '@/lib/company-scope';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useChatWorkSettings } from '../hooks/useChatWork';
export default function SalesDispositionControl({
  roomId,
  journey,
}: {
  roomId: string;
  journey: JourneySummary;
}) {
  const work = useChatWorkSettings();
  const client = useQueryClient();
  const [action, setAction] = useState<'MARK_LOST' | 'REOPEN' | null>(null);
  const [reason, setReason] = useState('');
  const request = useRef('');
  const identity = `${work.company}:${roomId}`;
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    setAction(null);
    setReason('');
  }, [identity]);
  const save = useMutation({
    mutationFn: async () => {
      const revision = getCompanyScopeRevision();
      await api.post(
        `/staff-chat/rooms/${roomId}/sales-disposition`,
        { action, ...(action === 'MARK_LOST' ? { reason } : {}), clientRequestId: request.current },
        { params: work.scope },
      );
      return { identity, revision };
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['chat-work'] });
      void client.invalidateQueries({ queryKey: ['customer-journey'] });
      void client.invalidateQueries({ queryKey: ['customer-journey-summary'] });
      void client.invalidateQueries({ queryKey: ['todos'] });
      if (current.current !== result.identity || getCompanyScopeRevision() !== result.revision)
        return;
      setAction(null);
      toast.success('บันทึกประวัติการติดตามแล้ว');
    },
    onError: (error) => {
      if (identity !== current.current) return;
      toast.error(getErrorMessage(error));
      void client.invalidateQueries({ queryKey: [...work.key, 'sales-context', roomId] });
    },
  });
  if (journey.stage === 'PURCHASED') return null;
  const open = (value: 'MARK_LOST' | 'REOPEN') => {
    request.current = crypto.randomUUID();
    setReason('');
    setAction(value);
  };
  return (
    <div className="mt-3 border-t pt-2">
      {journey.lost && (
        <p className="text-xs leading-snug text-muted-foreground">
          ไม่ซื้อแล้ว · {JOURNEY_LOST_REASON_LABELS[journey.lost.reason] ?? 'เหตุผลอื่น'}
        </p>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="mt-1 w-full"
        onClick={() => open(journey.lost ? 'REOPEN' : 'MARK_LOST')}
      >
        {journey.lost ? 'กลับมาติดตาม' : 'ไม่ซื้อแล้ว'}
      </Button>
      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent>
          <DialogTitle>
            {action === 'MARK_LOST' ? 'บันทึกไม่ซื้อแล้ว' : 'กลับมาติดตามลูกค้า'}
          </DialogTitle>
          <DialogDescription>
            บันทึกเพิ่มในประวัติลูกค้า งานนัดและหลักฐานการขายยังอยู่ครบ
          </DialogDescription>
          {action === 'MARK_LOST' && (
            <label className="text-sm font-medium">
              เหตุผลที่ไม่ซื้อ
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">เลือกเหตุผล</option>
                {Object.entries(JOURNEY_LOST_REASON_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              ปิด
            </Button>
            <Button
              disabled={save.isPending || (action === 'MARK_LOST' && !reason)}
              onClick={() => save.mutate()}
            >
              {action === 'MARK_LOST' ? 'บันทึกเหตุผล' : 'บันทึกกลับมาติดตาม'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

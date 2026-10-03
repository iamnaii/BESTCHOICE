import { BroadcastMessageReview } from './BroadcastMessageReview';
import type { BroadcastHistoryRecord } from './api-contract';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export function BroadcastReviewActions({
  id,
  createdById,
  messages,
  scheduledAt,
}: {
  id: string;
  createdById: string;
  messages: BroadcastHistoryRecord['messages'];
  scheduledAt: string | null;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(
          `/line-oa/broadcast/${id}/${action}`,
          action === 'reject' ? { reason: reason.trim() } : {},
        )
      ).data as { success: boolean; message: string },
    onSuccess: (data) => {
      if (data.success) toast.success(data.message);
      else toast.error(data.message);
      setAction(null);
      queryClient.invalidateQueries({ queryKey: ['broadcast-history'] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  if (!user || user.id === createdById)
    return <p className="text-xs text-muted-foreground">รอผู้อนุมัติคนที่สอง</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setAction('approve')}>
        อนุมัติ
      </Button>
      <Button size="sm" variant="outline" onClick={() => setAction('reject')}>
        ปฏิเสธ
      </Button>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={action === 'approve' ? 'อนุมัติ Broadcast' : 'ปฏิเสธ Broadcast'}
        description={
          action === 'approve'
            ? 'อนุมัติแล้วระบบจะส่งทันที หรือส่งตามเวลาที่ตั้งไว้'
            : 'ระบุเหตุผลอย่างน้อย 5 ตัวอักษรเพื่อปฏิเสธรายการนี้'
        }
        confirmLabel={action === 'approve' ? 'ยืนยันอนุมัติ' : 'ยืนยันปฏิเสธ'}
        closeOnConfirm={false}
        confirmDisabled={action === 'reject' && reason.trim().length < 5}
        loading={mutation.isPending}
        onConfirm={() => {
          if (action === 'reject' && reason.trim().length < 5) {
            toast.error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
            return;
          }
          mutation.mutate();
        }}
      >
        {action === 'approve' && (
          <>
            <p className="text-sm">
              {scheduledAt
                ? `เวลาส่งที่ตั้งไว้: ${new Date(scheduledAt).toLocaleString('th-TH')}`
                : 'ส่งทันทีหลังอนุมัติ'}
            </p>
            <BroadcastMessageReview messages={messages} />
          </>
        )}
        {action === 'reject' && (
          <Input
            aria-label="เหตุผลการปฏิเสธ"
            placeholder="เหตุผลอย่างน้อย 5 ตัวอักษร"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </ConfirmDialog>
    </div>
  );
}

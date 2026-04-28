import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  receiptId: string | null;
  receiptNumber?: string;
  onClose: () => void;
}

export default function ReceiptVoidDialog({ receiptId, receiptNumber, onClose }: Props) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  const voidMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/receipts/${id}/void`, { reason });
      return data;
    },
    onSuccess: () => {
      toast.success('ยกเลิกใบเสร็จสำเร็จ — สร้างใบลดหนี้แล้ว');
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['contract-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['contract-payments'] });
      setReason('');
      onClose();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog
      open={!!receiptId}
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ยกเลิกใบเสร็จ</DialogTitle>
          <DialogDescription>
            ระบบจะสร้างใบลดหนี้ (Credit Note) อ้างอิงใบเสร็จ
            {receiptNumber ? <span className="font-mono"> {receiptNumber}</span> : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">เหตุผลที่ยกเลิก</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ลูกค้าโอนผิดบัญชี, บันทึกผิด..."
            rows={3}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={voidMutation.isPending}>
            ปิด
          </Button>
          <Button
            variant="destructive"
            onClick={() => receiptId && voidMutation.mutate(receiptId)}
            disabled={!reason.trim() || voidMutation.isPending}
          >
            {voidMutation.isPending ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

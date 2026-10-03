import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import * as z from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export interface TicketReasonDialogProps {
  ticketId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const schema = z.object({
  note: z.string().min(5, 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'),
});

type FormVals = z.infer<typeof schema>;

const ACTIONS = {
  cancel: {
    title: 'ยกเลิกตั๋วซ่อม',
    label: 'เหตุผลการยกเลิก',
    placeholder: 'เช่น ลูกค้าขอยกเลิก ไม่ต้องซ่อมแล้ว',
    closeLabel: 'ปิด',
    submitLabel: 'ยืนยันยกเลิก',
    success: 'ยกเลิกตั๋วแล้ว',
    variant: 'destructive',
  },
  'send-back': {
    title: 'ส่งซ่อมต่อ (ส่งกลับศูนย์)',
    label: 'เหตุผล',
    placeholder: 'เช่น ซ่อมแล้วยังเสียอยู่ ส่งซ่อมต่อ',
    closeLabel: 'ยกเลิก',
    submitLabel: 'ส่งซ่อมต่อ',
    success: 'ส่งซ่อมต่อแล้ว',
    variant: undefined,
  },
} as const;

export function TicketReasonDialog({
  ticketId,
  onClose,
  onSuccess,
  action,
}: TicketReasonDialogProps & { action: keyof typeof ACTIONS }) {
  const config = ACTIONS[action];
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormVals>({ resolver: standardSchemaResolver(schema) });

  const mut = useMutation({
    mutationFn: async (v: FormVals) => api.post(`/repair-tickets/${ticketId}/${action}`, v),
    onSuccess: () => {
      toast.success(config.success);
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mut.mutate(v))} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="note">
              {config.label} <span className="text-destructive">*</span>
            </Label>
            <Textarea id="note" placeholder={config.placeholder} {...register('note')} rows={4} />
            {errors.note && (
              <p className="text-xs text-destructive leading-snug">{errors.note.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {config.closeLabel}
            </Button>
            <Button type="submit" variant={config.variant} disabled={mut.isPending}>
              {mut.isPending ? 'กำลังบันทึก...' : config.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

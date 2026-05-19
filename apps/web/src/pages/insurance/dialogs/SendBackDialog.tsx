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

interface Props {
  ticketId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const schema = z.object({
  note: z.string().min(5, 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'),
});

type FormVals = z.infer<typeof schema>;

export function SendBackDialog({ ticketId, onClose, onSuccess }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormVals>({ resolver: standardSchemaResolver(schema) });

  const mut = useMutation({
    mutationFn: async (v: FormVals) =>
      api.post(`/repair-tickets/${ticketId}/send-back`, v),
    onSuccess: () => {
      toast.success('ส่งซ่อมต่อแล้ว');
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ส่งซ่อมต่อ (ส่งกลับศูนย์)</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mut.mutate(v))} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="note">
              เหตุผล <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="note"
              placeholder="เช่น ซ่อมแล้วยังเสียอยู่ ส่งซ่อมต่อ"
              {...register('note')}
              rows={4}
            />
            {errors.note && (
              <p className="text-xs text-destructive leading-snug">{errors.note.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? 'กำลังบันทึก...' : 'ส่งซ่อมต่อ'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

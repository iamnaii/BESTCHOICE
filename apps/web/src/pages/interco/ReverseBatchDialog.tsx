import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — ย้อนกลับรอบจ่าย POSTED → REVERSED
 * (spec §5 "ยกเลิกรอบที่ POSTED": mirror-reverse ทั้ง 2 ใบ JE, เหตุผล ≥10
 * ตัวอักษร, role OWNER/FINANCE_MANAGER เท่านั้น — role gate อยู่ที่ปุ่มเรียก
 * ใน `BatchDetailSheet`).
 */

const reverseSchema = z.object({
  reason: z
    .string()
    .min(10, 'เหตุผลย้อนกลับต้องมีอย่างน้อย 10 ตัวอักษร')
    .max(500, 'เหตุผลยาวเกินไป (สูงสุด 500 ตัวอักษร)'),
});
type ReverseFormValues = z.infer<typeof reverseSchema>;

interface ReverseBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchNumber: string;
  onReversed: () => void;
}

export function ReverseBatchDialog({
  open,
  onOpenChange,
  batchId,
  batchNumber,
  onReversed,
}: ReverseBatchDialogProps) {
  const form = useForm<ReverseFormValues>({
    resolver: standardSchemaResolver(reverseSchema),
    defaultValues: { reason: '' },
  });

  useEffect(() => {
    if (open) form.reset({ reason: '' });
  }, [open, form]);

  const reverseMutation = useMutation({
    mutationFn: async (values: ReverseFormValues) =>
      api.post(`/interco-settlement/batches/${batchId}/reverse`, values),
    onSuccess: () => {
      toast.success('ย้อนกลับรอบจ่ายเรียบร้อย');
      onOpenChange(false);
      onReversed();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !reverseMutation.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ย้อนกลับรอบจ่าย {batchNumber}</DialogTitle>
          <DialogDescription className="leading-snug">
            จะสร้าง JE กลับรายการทั้ง 2 ฝั่ง (สลับ Dr↔Cr) — สัญญาในรอบนี้จะกลับเข้าคิวรอจ่ายทันที
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((v) => reverseMutation.mutate(v))}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="ic-reverse-reason">เหตุผล (อย่างน้อย 10 ตัวอักษร) *</Label>
            <Textarea
              id="ic-reverse-reason"
              rows={4}
              placeholder="ระบุเหตุผลการย้อนกลับอย่างละเอียด..."
              {...form.register('reason')}
              disabled={reverseMutation.isPending}
            />
            {form.formState.errors.reason && (
              <p className="text-xs text-destructive leading-snug">
                {form.formState.errors.reason.message}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={reverseMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button type="submit" variant="destructive" disabled={reverseMutation.isPending}>
              {reverseMutation.isPending ? 'กำลังย้อนกลับ...' : 'ยืนยันย้อนกลับ'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

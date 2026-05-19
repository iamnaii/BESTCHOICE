import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  ticketId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const schema = z.object({
  actualCost: z.coerce.number().min(0, 'กรุณาระบุค่าซ่อมจริง'),
  payer: z.enum(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM'], { required_error: 'กรุณาเลือกผู้รับผิดชอบ' }),
});

type FormVals = z.infer<typeof schema>;

const PAYER_LABELS: Record<string, string> = {
  SHOP: 'ร้าน (ประกัน)',
  CUSTOMER: 'ลูกค้า',
  SUPPLIER_CLAIM: 'เคลมกับศูนย์',
};

export function MarkRepairedDialog({ ticketId, onClose, onSuccess }: Props) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: { payer: 'SHOP' },
  });

  const mut = useMutation({
    mutationFn: async (v: FormVals) =>
      api.post(`/repair-tickets/${ticketId}/mark-repaired`, v),
    onSuccess: () => {
      toast.success('บันทึกซ่อมเสร็จแล้ว');
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกซ่อมเสร็จ</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mut.mutate(v))} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="actualCost">
              ค่าซ่อมจริง (บาท) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="actualCost"
              type="number"
              min="0"
              step="0.01"
              {...register('actualCost')}
              placeholder="0"
            />
            {errors.actualCost && (
              <p className="text-xs text-destructive leading-snug">{errors.actualCost.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>
              ผู้รับผิดชอบค่าซ่อม <span className="text-destructive">*</span>
            </Label>
            <Select
              onValueChange={(v) => setValue('payer', v as FormVals['payer'])}
              defaultValue="SHOP"
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PAYER_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.payer && (
              <p className="text-xs text-destructive leading-snug">{errors.payer.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

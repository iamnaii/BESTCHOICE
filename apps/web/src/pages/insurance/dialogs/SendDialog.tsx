import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { RepairCenterCombobox } from '../components/RepairCenterCombobox';

interface Props {
  ticketId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormVals {
  repairSupplierId: string;
  externalClaimNo: string;
  estimatedCost: string;
}

export function SendDialog({ ticketId, onClose, onSuccess }: Props) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormVals>();

  const [repairSupplierId, setRepairSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');

  const mut = useMutation({
    mutationFn: async (v: FormVals) =>
      api.post(`/repair-tickets/${ticketId}/send`, {
        repairSupplierId: v.repairSupplierId || undefined,
        externalClaimNo: v.externalClaimNo || undefined,
        estimatedCost: v.estimatedCost ? Number(v.estimatedCost) : undefined,
      }),
    onSuccess: () => {
      toast.success('ส่งซ่อมแล้ว');
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ส่งซ่อม</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mut.mutate(v))} className="space-y-4">
          <div className="space-y-1">
            <Label>
              ที่ซ่อม <span className="text-destructive">*</span>
            </Label>
            <RepairCenterCombobox
              value={repairSupplierId}
              displayName={supplierName}
              invalid={!!errors.repairSupplierId}
              onSelect={({ id, name }) => {
                setRepairSupplierId(id);
                setSupplierName(name);
                setValue('repairSupplierId', id, { shouldValidate: true });
              }}
            />
            {errors.repairSupplierId && (
              <p className="text-xs text-destructive leading-snug">
                {errors.repairSupplierId.message}
              </p>
            )}
            <Input type="hidden" {...register('repairSupplierId', { required: 'กรุณาเลือกที่ซ่อม' })} />
          </div>

          <div className="space-y-1">
            <Label>เลข Claim ของศูนย์ (ถ้ามี)</Label>
            <Input {...register('externalClaimNo')} placeholder="เช่น CLM-2026-0001" />
          </div>

          <div className="space-y-1">
            <Label>ค่าซ่อมประมาณ (บาท)</Label>
            <Input type="number" min="0" step="0.01" {...register('estimatedCost')} placeholder="0" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? 'กำลังบันทึก...' : 'ส่งซ่อม'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

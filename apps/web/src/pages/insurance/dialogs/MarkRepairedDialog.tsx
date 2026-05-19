import { useState } from 'react';
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

type Payer = 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';

const PAYER_LABELS: Record<Payer, string> = {
  SHOP: 'ร้าน (ประกัน)',
  CUSTOMER: 'ลูกค้า',
  SUPPLIER_CLAIM: 'เคลมกับศูนย์',
};

export function MarkRepairedDialog({ ticketId, onClose, onSuccess }: Props) {
  const [actualCost, setActualCost] = useState('');
  const [payer, setPayer] = useState<Payer>('SHOP');
  const [costError, setCostError] = useState('');

  const mut = useMutation({
    mutationFn: async () => {
      const cost = parseFloat(actualCost);
      if (isNaN(cost) || cost < 0) {
        setCostError('กรุณาระบุค่าซ่อมจริง (ตัวเลข ≥ 0)');
        throw new Error('validation');
      }
      return api.post(`/repair-tickets/${ticketId}/mark-repaired`, {
        actualCost: cost,
        payer,
      });
    },
    onSuccess: () => {
      toast.success('บันทึกซ่อมเสร็จแล้ว');
      onSuccess();
      onClose();
    },
    onError: (e) => {
      if ((e as Error).message !== 'validation') {
        toast.error(getErrorMessage(e));
      }
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกซ่อมเสร็จ</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="actualCost">
              ค่าซ่อมจริง (บาท) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="actualCost"
              type="number"
              min="0"
              step="0.01"
              value={actualCost}
              onChange={(e) => {
                setActualCost(e.target.value);
                setCostError('');
              }}
              placeholder="0"
            />
            {costError && (
              <p className="text-xs text-destructive leading-snug">{costError}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>
              ผู้รับผิดชอบค่าซ่อม <span className="text-destructive">*</span>
            </Label>
            <Select onValueChange={(v) => setPayer(v as Payer)} defaultValue="SHOP">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(PAYER_LABELS) as [Payer, string][]).map(([val, label]) => (
                  <SelectItem key={val} value={val}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
              {mut.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

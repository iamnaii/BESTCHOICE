import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useManageActions } from '../hooks/useManagerBoard';

interface Collector {
  id: string;
  name: string;
  assignments: Array<unknown>;
}

interface Props {
  fromCollectorId: string | null;
  collectors: Collector[];
  onClose: () => void;
}

export default function TransferDialog({ fromCollectorId, collectors, onClose }: Props) {
  const { transfer } = useManageActions();
  const [toId, setToId] = useState('');
  const [count, setCount] = useState(5);

  useEffect(() => {
    if (fromCollectorId) {
      setToId('');
      setCount(5);
    }
  }, [fromCollectorId]);

  const fromName = collectors.find((c) => c.id === fromCollectorId)?.name ?? '';
  const others = collectors.filter((c) => c.id !== fromCollectorId);

  const submit = () => {
    if (!fromCollectorId || !toId) return;
    transfer.mutate(
      { fromCollectorId, toCollectorId: toId, count },
      {
        onSuccess: (res: any) => {
          const moved = res?.data?.moved ?? count;
          toast.success(`โอน ${moved} รายการแล้ว`);
          onClose();
        },
        onError: () => toast.error('โอนไม่สำเร็จ'),
      },
    );
  };

  return (
    <Dialog open={!!fromCollectorId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>โอนคิวจาก {fromName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="leading-snug">โอนไปให้</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger>
                <SelectValue placeholder="เลือกพนักงาน" />
              </SelectTrigger>
              <SelectContent>
                {others.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.assignments.length} ราย)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="leading-snug">จำนวน</Label>
            <Input
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={submit} disabled={!toId || transfer.isPending}>
            โอน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
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
import { AlertTriangle, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api';
import { useLockContract } from '../hooks/useMdmLock';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contractId: string;
  customerName: string;
  daysOverdue: number;
}

const PRESET_REASONS = [
  'ค้างชำระเกิน 3 วัน',
  'ลูกค้าผิดนัดชำระหลายครั้ง',
  'ลูกค้าหายตัว ติดต่อไม่ได้',
  'อื่นๆ',
];

export default function LockDeviceDialog({
  open,
  onOpenChange,
  contractId,
  customerName,
  daysOverdue,
}: Props) {
  const lock = useLockContract();
  const [presetReason, setPresetReason] = useState(PRESET_REASONS[0]);
  const [customReason, setCustomReason] = useState('');

  const submit = () => {
    const reason =
      presetReason === 'อื่นๆ' ? customReason.trim() : presetReason;
    if (!reason) {
      toast.error('กรุณาระบุเหตุผล');
      return;
    }
    lock.mutate(
      { contractId, reason },
      {
        onSuccess: (data) => {
          if (data && data.success === false) {
            toast.error(data.message ?? 'ล็อคเครื่องไม่สำเร็จ');
            return;
          }
          toast.success('ล็อคเครื่องแล้ว');
          onOpenChange(false);
          setCustomReason('');
        },
        onError: (err) => {
          toast.error(getErrorMessage(err));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-5 text-destructive" />
            ล็อคเครื่อง — เปิดโหมดสูญหาย
          </DialogTitle>
          <DialogDescription className="leading-snug">
            ลูกค้าจะใช้โทรศัพท์ไม่ได้จนกว่าจะปลดล็อค
            แสดงข้อความบนหน้าจอเครื่องเพื่อให้ติดต่อกลับ
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 flex gap-2.5">
          <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm leading-snug">
            <span className="font-semibold">{customerName}</span> ค้างมาแล้ว{' '}
            <span className="tabular-nums font-semibold">{daysOverdue}</span> วัน
            <br />
            แน่ใจว่าต้องการล็อคเครื่อง?
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="leading-snug mb-2 block">เหตุผล</Label>
            <div className="space-y-1.5">
              {PRESET_REASONS.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-2 cursor-pointer text-sm leading-snug"
                >
                  <input
                    type="radio"
                    name="lock-reason"
                    value={r}
                    checked={presetReason === r}
                    onChange={() => setPresetReason(r)}
                    className="size-4 accent-primary"
                  />
                  {r}
                </label>
              ))}
            </div>
          </div>

          {presetReason === 'อื่นๆ' && (
            <div>
              <Label className="leading-snug mb-1 block">ระบุเหตุผล</Label>
              <Textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                maxLength={500}
                placeholder="เหตุผล..."
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={lock.isPending}
          >
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={lock.isPending}
          >
            {lock.isPending ? 'กำลังล็อค...' : 'ยืนยันล็อคเครื่อง'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

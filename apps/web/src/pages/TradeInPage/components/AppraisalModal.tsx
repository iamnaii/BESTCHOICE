import { toast } from 'sonner';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TradeIn } from '../types';

interface AppraisalModalProps {
  item: TradeIn | null;
  value: string;
  condition: string;
  isPending: boolean;
  onValueChange: (v: string) => void;
  onConditionChange: (v: string) => void;
  onConfirm: (id: string, value: number, condition: string) => void;
  onClose: () => void;
}

export default function AppraisalModal({
  item,
  value,
  condition,
  isPending,
  onValueChange,
  onConditionChange,
  onConfirm,
  onClose,
}: AppraisalModalProps) {
  function handleConfirm() {
    if (!value || parseFloat(value) <= 0) {
      toast.error('กรุณาระบุราคาประเมิน');
      return;
    }
    if (!item) return;
    onConfirm(item.id, parseFloat(value), condition);
  }

  return (
    <Modal isOpen={!!item} onClose={onClose} title="ประเมินราคาเครื่อง" size="sm">
      {item && (
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p>
              <strong>อุปกรณ์:</strong> {item.deviceBrand} {item.deviceModel}
            </p>
            <p>
              <strong>ผู้ขาย:</strong> {item.customer?.name || item.sellerName || '-'}
            </p>
            {item.estimatedValue != null && (
              <p>
                <strong>ราคาประเมินเบื้องต้น:</strong> ฿
                {Number(item.estimatedValue).toLocaleString()}
              </p>
            )}
          </div>
          <div>
            <Label>สภาพเครื่อง *</Label>
            <select
              className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
              value={condition}
              onChange={(e) => onConditionChange(e.target.value)}
            >
              <option value="A">A — ดีเยี่ยม</option>
              <option value="B">B — ดี</option>
              <option value="C">C — พอใช้</option>
              <option value="D">D — ไม่ดี</option>
            </select>
          </div>
          <div>
            <Label>ราคาที่เสนอ (บาท) *</Label>
            <Input
              className="mt-1"
              type="number"
              placeholder="0"
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending ? 'กำลังบันทึก...' : 'ยืนยันประเมิน'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

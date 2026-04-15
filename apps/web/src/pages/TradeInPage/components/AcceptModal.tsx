import { toast } from 'sonner';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SignaturePadFull from '@/components/signing/SignaturePadFull';
import { AlertTriangle } from 'lucide-react';
import type { TradeIn, AcceptFormState } from '../types';

interface AcceptModalProps {
  item: TradeIn | null;
  form: AcceptFormState;
  isPending: boolean;
  onChange: (patch: Partial<AcceptFormState>) => void;
  onConfirm: (id: string, body: AcceptFormState) => void;
  onClose: () => void;
}

export default function AcceptModal({
  item,
  form,
  isPending,
  onChange,
  onConfirm,
  onClose,
}: AcceptModalProps) {
  function handleConfirm() {
    if (!item) return;
    if (!form.idCardVerified || !form.sellerConsentSigned) {
      toast.error('กรุณายืนยันการตรวจบัตรและความยินยอมก่อน');
      return;
    }
    if (form.paymentMethod === 'TRANSFER') {
      if (!form.transferBankName || !form.transferAccountNumber || !form.transferAccountName) {
        toast.error('กรุณากรอกข้อมูลการโอนให้ครบ');
        return;
      }
    }
    if (!form.sellerSignatureBase64) {
      toast.error('กรุณาให้ผู้ขายลงลายเซ็นก่อน');
      return;
    }
    onConfirm(item.id, form);
  }

  return (
    <Modal isOpen={!!item} onClose={onClose} title="ยืนยันการรับซื้อเครื่อง" size="md">
      {item && (
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-3 text-xs text-amber-700 dark:text-amber-400 flex gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>กรุณายืนยันตามขั้นตอนป้องกันการรับซื้อของโจรก่อนกดยอมรับ</div>
          </div>
          <div className="text-sm">
            <p>
              <strong>อุปกรณ์:</strong> {item.deviceBrand} {item.deviceModel}
            </p>
            <p>
              <strong>ผู้ขาย:</strong> {item.customer?.name || item.sellerName || '-'}
            </p>
            <p>
              <strong>ราคาตกลง:</strong> ฿{Number(item.offeredPrice ?? 0).toLocaleString()}
            </p>
          </div>
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.idCardVerified}
              onChange={(e) => onChange({ idCardVerified: e.target.checked })}
            />
            <span className="text-sm">ตรวจบัตรประชาชนผู้ขายแล้วและตรงกับใบหน้า</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.sellerConsentSigned}
              onChange={(e) => onChange({ sellerConsentSigned: e.target.checked })}
            />
            <span className="text-sm">ผู้ขายเซ็นยืนยันว่าเป็นเจ้าของเครื่องโดยชอบด้วยกฎหมาย</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.policeReportAcknowledged}
              onChange={(e) => onChange({ policeReportAcknowledged: e.target.checked })}
            />
            <span className="text-sm">
              แจ้งผู้ขายแล้วว่าหากเป็นของโจรจะถูกดำเนินคดีตามกฎหมาย
            </span>
          </label>

          {/* Payment method */}
          <div className="border-t pt-3 mt-2">
            <Label>วิธีชำระเงินให้ผู้ขาย *</Label>
            <div className="flex gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => onChange({ paymentMethod: 'CASH' })}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  form.paymentMethod === 'CASH'
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300'
                }`}
              >
                เงินสด
              </button>
              <button
                type="button"
                onClick={() => onChange({ paymentMethod: 'TRANSFER' })}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  form.paymentMethod === 'TRANSFER'
                    ? 'bg-sky-500 text-white border-sky-500'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-sky-300'
                }`}
              >
                โอน
              </button>
            </div>
            {form.paymentMethod === 'TRANSFER' && (
              <div className="space-y-2 mt-3">
                <Input
                  placeholder="ธนาคาร เช่น กสิกรไทย"
                  value={form.transferBankName}
                  onChange={(e) => onChange({ transferBankName: e.target.value })}
                />
                <Input
                  placeholder="เลขบัญชีผู้รับโอน"
                  value={form.transferAccountNumber}
                  onChange={(e) =>
                    onChange({ transferAccountNumber: e.target.value.replace(/[^\d-]/g, '') })
                  }
                />
                <Input
                  placeholder="ชื่อบัญชี"
                  value={form.transferAccountName}
                  onChange={(e) => onChange({ transferAccountName: e.target.value })}
                />
              </div>
            )}
          </div>

          {/* ลายเซ็นผู้ขาย */}
          <div className="border-t pt-3">
            <Label>ลายเซ็นผู้ขาย *</Label>
            <p className="text-xs text-muted-foreground mb-2">
              ผู้ขายลงนามยืนยันการขายและความเป็นเจ้าของ
            </p>
            <SignaturePadFull
              onSign={() => {
                /* handled by submit button */
              }}
              onDraftChange={(dataUrl) =>
                onChange({ sellerSignatureBase64: dataUrl || '' })
              }
              buttonText=""
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending ? 'กำลังบันทึก...' : 'ยืนยันรับซื้อ'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

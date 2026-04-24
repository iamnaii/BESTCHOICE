import { useState, useEffect } from 'react';
import { Banknote, Landmark, QrCode } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useRecordPayment } from '../hooks/useRecordPayment';
import type { PaymentMethod } from '../hooks/useRecordPayment';
import type { ContractRow } from '../types';

interface Props {
  open: boolean;
  contract: ContractRow | null;
  onClose: () => void;
}

const METHOD_OPTIONS: { key: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { key: 'CASH', label: 'เงินสด', icon: <Banknote className="size-5" /> },
  { key: 'BANK_TRANSFER', label: 'โอน', icon: <Landmark className="size-5" /> },
  { key: 'QR_EWALLET', label: 'QR', icon: <QrCode className="size-5" /> },
];

export default function PaymentRecordDialog({ open, contract, onClose }: Props) {
  const [amount, setAmount] = useState<string>('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [notes, setNotes] = useState('');

  const mutation = useRecordPayment();

  // Pre-fill amount from outstanding on open
  useEffect(() => {
    if (open && contract) {
      setAmount(contract.outstanding > 0 ? contract.outstanding.toString() : '');
      setMethod('CASH');
      setNotes('');
    }
  }, [open, contract?.id]);

  const amountNum = parseFloat(amount);
  const validAmount = !isNaN(amountNum) && amountNum > 0;

  function handleSubmit() {
    if (!contract || !validAmount) return;
    mutation.mutate(
      {
        contractId: contract.id,
        amount: amountNum,
        paymentMethod: method,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          onClose();
          setAmount('');
          setNotes('');
        },
      },
    );
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="บันทึกการชำระเงิน" size="md">
      <div className="space-y-5 p-1">
        {/* Customer summary */}
        {contract && (
          <div className="flex items-center justify-between text-sm border-b border-border pb-3">
            <div>
              <div className="font-semibold leading-snug">{contract.customer.name}</div>
              <div className="font-mono text-xs text-primary">{contract.contractNumber}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground leading-snug">ค้างชำระ</div>
              <div className="text-lg font-bold tabular-nums text-destructive">
                {contract.outstanding.toLocaleString()} ฿
              </div>
            </div>
          </div>
        )}

        {/* Amount (hero) */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
            จำนวนเงิน (บาท)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-4 py-3 border border-input rounded-lg text-2xl font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus:border-transparent"
            autoFocus
          />
          <div className="mt-1 text-xs text-muted-foreground leading-snug">
            {contract && contract.outstanding > 0 && (
              <button
                type="button"
                onClick={() => setAmount(contract.outstanding.toString())}
                className="hover:text-foreground underline transition-colors"
              >
                ใช้ยอดค้าง {contract.outstanding.toLocaleString()} ฿
              </button>
            )}
          </div>
        </div>

        {/* Payment method — radio tiles */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
            วิธีชำระ
          </label>
          <div className="grid grid-cols-3 gap-2">
            {METHOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setMethod(opt.key)}
                className={`flex flex-col items-center gap-1 py-3 rounded-lg border transition-colors ${
                  method === opt.key
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {opt.icon}
                <span className="text-xs font-medium leading-snug">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
            หมายเหตุ (ไม่บังคับ)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm resize-none leading-snug"
            placeholder="เช่น จ่ายผ่านโอน KBank อ้างอิง XXX"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!validAmount || mutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending
              ? 'กำลังบันทึก...'
              : `บันทึกชำระ${validAmount ? ` ${amountNum.toLocaleString()} ฿` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

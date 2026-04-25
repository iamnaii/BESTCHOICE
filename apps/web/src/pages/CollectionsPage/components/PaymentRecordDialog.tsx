import { useState, useEffect } from 'react';
import { Banknote, Landmark, QrCode, ImageUp, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import Modal from '@/components/ui/Modal';
import api, { getErrorMessage } from '@/lib/api';
import { formatNumber } from '@/utils/formatters';
import { useRecordPayment } from '../hooks/useRecordPayment';
import type { PaymentMethod } from '../hooks/useRecordPayment';
import type { ContractRow } from '../types';

// Money string validator: non-empty, digits with optional single decimal (up to 2 places), > 0.
// Avoids parseFloat() precision issues on money input — works purely on the raw string.
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
function isValidMoneyString(s: string): boolean {
  const trimmed = s.trim();
  if (!MONEY_PATTERN.test(trimmed)) return false;
  // Reject "0" and "0.00" etc without relying on parseFloat
  return /[1-9]/.test(trimmed);
}

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

  // Slip upload state
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipUrl, setSlipUrl] = useState<string>('');
  const [uploadingSlip, setUploadingSlip] = useState(false);

  const mutation = useRecordPayment();

  const requiresSlip = method === 'BANK_TRANSFER' || method === 'QR_EWALLET';

  // Pre-fill amount from outstanding on open
  useEffect(() => {
    if (open && contract) {
      setAmount(contract.outstanding > 0 ? contract.outstanding.toString() : '');
      setMethod('CASH');
      setNotes('');
      setSlipFile(null);
      setSlipUrl('');
    }
  }, [open, contract?.id]);

  // Reset slip when method changes away from transfer types
  useEffect(() => {
    if (!requiresSlip) {
      setSlipFile(null);
      setSlipUrl('');
    }
  }, [requiresSlip]);

  const handleSlipChange = async (file: File) => {
    setSlipFile(file);
    setUploadingSlip(true);
    setSlipUrl('');
    try {
      const { data: presigned } = await api.post('/shop/upload/signed-url', {
        kind: 'BANK_SLIP',
        contentType: file.type,
      });
      const up = await fetch(presigned.uploadUrl, {
        method: presigned.method ?? 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!up.ok) throw new Error('Upload failed');
      setSlipUrl(presigned.publicUrl);
      toast.success('อัปโหลดสลิปสำเร็จ');
    } catch (err) {
      toast.error(getErrorMessage(err));
      setSlipFile(null);
    } finally {
      setUploadingSlip(false);
    }
  };

  const validAmount = isValidMoneyString(amount);
  const canSubmit =
    validAmount && !mutation.isPending && !uploadingSlip && (!requiresSlip || !!slipUrl);

  function handleSubmit() {
    if (!contract || !canSubmit) return;
    // Conversion happens once at submit boundary — backend is the authoritative validator.
    mutation.mutate(
      {
        contractId: contract.id,
        amount: Number(amount.trim()),
        paymentMethod: method,
        notes: notes || undefined,
        evidenceUrl: slipUrl || undefined,
      },
      {
        onSuccess: () => {
          onClose();
          setAmount('');
          setNotes('');
          setSlipFile(null);
          setSlipUrl('');
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
                {formatNumber(contract.outstanding)} ฿
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
                ใช้ยอดค้าง {formatNumber(contract.outstanding)} ฿
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

        {/* Slip upload — shown only for non-cash methods */}
        {requiresSlip && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
              สลิปการโอน{' '}
              <span className="text-destructive">*</span>
            </label>
            <label
              className={`flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${
                slipUrl
                  ? 'border-success/40 bg-success/5'
                  : 'border-input hover:border-primary/40 hover:bg-muted/50'
              }`}
            >
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={uploadingSlip}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSlipChange(f);
                }}
              />
              {slipUrl ? (
                <CircleCheck className="size-5 text-success shrink-0" />
              ) : (
                <ImageUp className="size-5 text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                {slipFile ? (
                  <div className="text-xs leading-snug">
                    <div className="font-medium text-foreground truncate">{slipFile.name}</div>
                    <div className="text-muted-foreground tabular-nums">
                      {(slipFile.size / 1024).toFixed(0)} KB
                      {uploadingSlip && ' · กำลังอัปโหลด...'}
                      {slipUrl && !uploadingSlip && (
                        <span className="text-success"> · อัปโหลดแล้ว</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground leading-snug">
                    คลิกเพื่อเลือกรูปสลิป (บังคับสำหรับโอน/QR)
                  </div>
                )}
              </div>
            </label>
          </div>
        )}

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
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending
              ? 'กำลังบันทึก...'
              : uploadingSlip
                ? 'กำลังอัปโหลดสลิป...'
                : `บันทึกชำระ${validAmount ? ` ${formatNumber(amount.trim())} ฿` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

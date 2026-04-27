import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { formatNumber } from '@/utils/formatters';
import { usePartialPaymentReschedule } from '../hooks/usePartialPaymentReschedule';
import type { ContractRow } from '../types';

interface Props {
  open: boolean;
  contract: ContractRow | null;
  onClose: () => void;
  onSaved?: () => void;
}

type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET';

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'เงินสด' },
  { value: 'BANK_TRANSFER', label: 'โอนธนาคาร' },
  { value: 'QR_EWALLET', label: 'QR / e-Wallet' },
];

const QUICK_DATE_OPTIONS: Array<{ label: string; offsetDays?: number; endOfMonth?: boolean }> = [
  { label: 'พรุ่งนี้', offsetDays: 1 },
  { label: 'อีก 3 วัน', offsetDays: 3 },
  { label: 'อีก 7 วัน', offsetDays: 7 },
  { label: 'สิ้นเดือน', endOfMonth: true },
];

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function endOfThisMonth(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().split('T')[0];
}

function getTomorrow(): string {
  return dateOffset(1);
}

export default function PartialPaymentRescheduleDialog({
  open,
  contract,
  onClose,
  onSaved,
}: Props) {
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [transactionRef, setTransactionRef] = useState('');
  const [newSettlementDate, setNewSettlementDate] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = usePartialPaymentReschedule();

  useEffect(() => {
    if (open) {
      setAmountPaid('');
      setPaymentMethod('CASH');
      setTransactionRef('');
      setNewSettlementDate('');
      setNotes('');
    }
  }, [open, contract?.id]);

  const outstanding = contract?.outstanding ?? 0;
  const amountPaidNum = Number(amountPaid);
  const amountPaidValid =
    Number.isFinite(amountPaidNum) && amountPaidNum > 0 && amountPaidNum <= outstanding;
  const isFullPayment = amountPaidValid && amountPaidNum === outstanding;
  const outstandingAfter = amountPaidValid
    ? +(outstanding - amountPaidNum).toFixed(2)
    : 0;

  // โอน/QR ต้องมี transaction ref (เพื่อ idempotency)
  const refRequired = paymentMethod !== 'CASH';
  const refValid = !refRequired || !!transactionRef.trim();

  // Reschedule date จำเป็นเฉพาะกรณี partial — full payment ปิดงานเลย
  const rescheduleValid = isFullPayment || !!newSettlementDate;
  const canSave = amountPaidValid && refValid && rescheduleValid && !mutation.isPending;

  function handleClose() {
    if (mutation.isPending) return;
    onClose();
  }

  function pickQuickDate(opt: (typeof QUICK_DATE_OPTIONS)[number]) {
    if (opt.endOfMonth) setNewSettlementDate(endOfThisMonth());
    else if (opt.offsetDays != null) setNewSettlementDate(dateOffset(opt.offsetDays));
  }

  function handleSubmit() {
    if (!contract || !canSave) return;
    mutation.mutate(
      {
        contractId: contract.id,
        amountPaid: amountPaidNum,
        paymentMethod,
        transactionRef: transactionRef.trim() || undefined,
        newSettlementDate: isFullPayment ? undefined : newSettlementDate,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          onSaved?.();
          handleClose();
        },
      },
    );
  }

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title={`บันทึกชำระเงิน — ${contract?.customer.name ?? ''}`}
      size="md"
    >
      <div className="space-y-5">
        {/* Contract summary */}
        {contract && (
          <div className="rounded-xl bg-muted/40 px-4 py-3 flex items-baseline justify-between gap-3">
            <span className="font-mono text-sm text-primary font-medium leading-snug">
              {contract.contractNumber}
            </span>
            <span className="text-sm leading-snug">
              ค้าง{' '}
              <span className="text-lg font-bold tabular-nums text-destructive">
                {formatNumber(outstanding)}
              </span>{' '}
              ฿
            </span>
          </div>
        )}

        {/* รับเงินวันนี้ */}
        <div className="space-y-3 rounded-xl border border-success/30 bg-success/5 p-4">
          <div className="text-sm font-semibold text-foreground leading-snug">
            ลูกค้าจ่ายวันนี้
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block leading-snug">
              จำนวนเงินที่จ่าย <span className="text-destructive">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button
                type="button"
                onClick={() => setAmountPaid(String(outstanding))}
                className="px-3 py-1.5 rounded-full text-sm font-medium border border-input bg-card hover:bg-muted transition-colors"
              >
                จ่ายเต็ม ({formatNumber(outstanding)} ฿)
              </button>
            </div>
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                min={0.01}
                max={outstanding}
                step="0.01"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2.5 pr-10 border border-input rounded-lg text-base leading-snug tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ฿
              </span>
            </div>
            {amountPaid && !amountPaidValid && (
              <p className="mt-1 text-xs text-destructive leading-snug">
                {amountPaidNum > outstanding
                  ? `ยอดเกินยอดค้าง (${formatNumber(outstanding)} ฿)`
                  : 'ยอดต้องมากกว่า 0'}
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block leading-snug">
              ช่องทางที่จ่าย <span className="text-destructive">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPaymentMethod(m.value)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium leading-snug transition-colors ${
                    paymentMethod === m.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input bg-card text-foreground hover:bg-muted'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {refRequired && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block leading-snug">
                เลขอ้างอิงธุรกรรม <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                placeholder="เลขที่ใบเสร็จ / ref โอน"
                className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug font-mono"
              />
            </div>
          )}
        </div>

        {/* Conditional: full payment → success banner. partial → reschedule form */}
        {isFullPayment ? (
          <div className="rounded-xl border border-success/40 bg-success/10 p-4 text-sm leading-snug text-success">
            <span className="font-semibold">จ่ายเต็มยอด</span> — บันทึกแล้วจะปิดงานสัญญาและออกใบเสร็จอัตโนมัติ
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-foreground leading-snug">
                นัดส่วนที่เหลือ
              </span>
              <span className="text-sm leading-snug">
                <span className="text-base font-bold tabular-nums text-warning">
                  {formatNumber(outstandingAfter)}
                </span>{' '}
                ฿
              </span>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block leading-snug">
                วันที่นัด <span className="text-destructive">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {QUICK_DATE_OPTIONS.map((opt) => {
                  const computed = opt.endOfMonth
                    ? endOfThisMonth()
                    : opt.offsetDays != null
                      ? dateOffset(opt.offsetDays)
                      : '';
                  const active = newSettlementDate === computed;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => pickQuickDate(opt)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card border-input hover:bg-muted'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <input
                type="date"
                min={getTomorrow()}
                value={newSettlementDate}
                onChange={(e) => setNewSettlementDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-input rounded-lg text-base leading-snug font-mono"
              />
            </div>
          </div>
        )}

        {/* บันทึกเพิ่มเติม */}
        <div>
          <label className="text-sm font-semibold text-foreground mb-1.5 block leading-snug">
            หมายเหตุ
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="รายละเอียดการสนทนา..."
            rows={2}
            className="w-full px-3 py-2.5 border border-input rounded-lg text-sm resize-none leading-relaxed"
          />
        </div>

        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary leading-snug">
          {isFullPayment
            ? 'ระบบจะบันทึกชำระเงิน + ออกใบเสร็จ + ส่ง LINE ยืนยันการปิดงานให้ลูกค้าทันที'
            : 'ระบบจะบันทึกชำระเงิน + ออกใบเสร็จ + ส่ง LINE แจ้งยอดที่นัดใหม่ให้ลูกค้าทันที'}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2 border-t border-border/40">
          <button
            onClick={handleClose}
            disabled={mutation.isPending}
            className="px-5 py-2.5 text-base border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSave}
            className="px-5 py-2.5 text-base bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

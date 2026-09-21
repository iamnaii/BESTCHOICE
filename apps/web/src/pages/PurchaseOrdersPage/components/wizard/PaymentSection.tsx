import { CreditCard, ImagePlus, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumberDecimal } from '@/utils/formatters';
import { paymentMethodLabels } from '../../constants';
import { CardHeader, card, fieldCls, labelCls } from './chrome';

export interface PaymentFields {
  paymentStatus: string;
  paymentMethod: string;
  paidAmount: string;
  paymentNotes: string;
}

export interface SupplierPaymentMethod {
  paymentMethod: string;
  bankName?: string;
  bankAccountNumber?: string;
  creditTermDays?: number;
  isDefault: boolean;
}

export const isPaidStatus = (status: string) => !!status && status !== 'UNPAID';
export const round2 = (n: number) => String(Math.round(n * 100) / 100);

/** Over-net check shared by every place a payment is keyed in (mirrors updatePayment()/approve() on the API). */
export function paidAmountError(payment: PaymentFields, netAmount: number): string | null {
  if (!isPaidStatus(payment.paymentStatus)) return null;
  const paid = Number(payment.paidAmount);
  if (!(paid > 0)) return 'ระบุจำนวนที่จ่าย';
  if (paid > netAmount) return `ยอดจ่ายเกินยอดสุทธิ (${formatNumberDecimal(netAmount, 2)} บาท)`;
  return null;
}

interface PaymentSectionProps {
  payment: PaymentFields;
  onChange: (patch: Partial<PaymentFields>) => void;
  netAmount: number;
  paymentMethods?: SupplierPaymentMethod[];
  attachmentUrl: string;
  setAttachmentUrl: (v: string) => void;
  attachments: string[];
  setAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  /** Prefix for the field ids (two of these can never share a page, but the dialog and wizard must not collide). */
  idPrefix?: string;
  /** Hint under the card title (card variant only). */
  hint?: string;
  /** Shown under the status select while ยังไม่จ่าย — e.g. when the credit falls due. */
  unpaidNote?: React.ReactNode;
  /** `card` = the wizard's boxed cards with a header; `plain` = bare fields for a dialog that has its own headers. */
  variant?: 'card' | 'plain';
}

/**
 * The one payment block (status / method / amount + 30·50·เต็ม chips / notes / slips) used by the
 * PO wizard's last step, the รับเข้าตรง summary and the approve dialog — owner 2026-09-06:
 * "การจ่ายเงินและแนบหลักฐานเป็นขั้นตอนเดียวกับการอนุมัติ", so all three must look and behave the same.
 */
export function PaymentSection({
  payment,
  onChange,
  netAmount,
  paymentMethods,
  attachmentUrl,
  setAttachmentUrl,
  attachments,
  setAttachments,
  idPrefix = 'po',
  hint = 'สถานะและวิธีการชำระเงิน — เว้นไว้ได้ถ้ายังไม่จ่าย',
  unpaidNote,
  variant = 'card',
}: PaymentSectionProps) {
  const paid = isPaidStatus(payment.paymentStatus);
  const partial = paid && payment.paymentStatus !== 'FULLY_PAID' && netAmount > 0;
  const amountError = paid && payment.paidAmount !== '' ? paidAmountError(payment, netAmount) : null;
  const Wrap = variant === 'card' ? 'section' : 'div';
  const wrapCls = variant === 'card' ? card : undefined;

  return (
    <>
      <Wrap className={wrapCls}>
        {variant === 'card' && (
          <CardHeader icon={<CreditCard className="size-4.5" />} tone="bg-warning/10 text-warning-strong" title="การจ่ายเงิน" hint={hint} />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={`${idPrefix}-payment-status`} className={labelCls}>สถานะการจ่าย</label>
            <select
              id={`${idPrefix}-payment-status`}
              aria-label="สถานะการจ่าย"
              value={payment.paymentStatus}
              onChange={(e) => {
                const status = e.target.value;
                onChange({
                  paymentStatus: status,
                  paidAmount: status === 'FULLY_PAID' ? round2(netAmount) : status === 'UNPAID' ? '' : payment.paidAmount,
                });
              }}
              className={fieldCls}
            >
              <option value="UNPAID">ยังไม่จ่าย</option>
              <option value="DEPOSIT_PAID">จ่ายมัดจำ</option>
              <option value="PARTIALLY_PAID">จ่ายบางส่วน</option>
              <option value="FULLY_PAID">จ่ายครบแล้ว</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-payment-method`} className={labelCls}>วิธีจ่ายเงิน</label>
            <select
              id={`${idPrefix}-payment-method`}
              aria-label="วิธีจ่ายเงิน"
              value={payment.paymentMethod}
              onChange={(e) => onChange({ paymentMethod: e.target.value })}
              className={fieldCls}
              disabled={!paid}
            >
              <option value="">-- เลือก --</option>
              {paymentMethods?.length ? (
                paymentMethods.map((pm, idx) => {
                  const detail = pm.bankName ? ` - ${pm.bankName}${pm.bankAccountNumber ? ` (${pm.bankAccountNumber})` : ''}` : '';
                  const credit = pm.creditTermDays ? ` ${pm.creditTermDays} วัน` : '';
                  return (
                    <option key={idx} value={pm.paymentMethod}>
                      {(paymentMethodLabels[pm.paymentMethod] || pm.paymentMethod) + detail + credit + (pm.isDefault ? ' (ค่าเริ่มต้น)' : '')}
                    </option>
                  );
                })
              ) : (
                Object.entries(paymentMethodLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-paid-amount`} className={labelCls}>จำนวนที่จ่าย (บาท)</label>
            <input
              id={`${idPrefix}-paid-amount`}
              aria-label="จำนวนที่จ่าย"
              type="number"
              min="0"
              step="0.01"
              value={payment.paidAmount}
              onChange={(e) => onChange({ paidAmount: e.target.value })}
              className={cn(fieldCls, amountError && 'border-destructive focus-visible:ring-destructive/30')}
              aria-invalid={amountError ? true : undefined}
              disabled={!paid}
              placeholder={paid ? '0' : '-'}
            />
            {partial && (
              <div className="mt-1.5 flex gap-1.5">
                {[
                  { label: '30%', value: round2(Math.round(netAmount * 0.3)) },
                  { label: '50%', value: round2(Math.round(netAmount * 0.5)) },
                  { label: 'เต็มจำนวน', value: round2(netAmount) },
                ].map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => onChange({ paidAmount: q.value })}
                    className="inline-flex h-7 cursor-pointer items-center rounded-full border border-input bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
            {amountError && (
              <p role="alert" className="mt-1 text-xs leading-snug text-destructive">
                {amountError}
              </p>
            )}
          </div>
        </div>
        {!paid && unpaidNote && <p className="mt-3 text-xs leading-snug text-muted-foreground">{unpaidNote}</p>}
        {paid && (
          <div className="mt-3">
            <label htmlFor={`${idPrefix}-payment-notes`} className={labelCls}>บันทึกการจ่าย</label>
            <input
              id={`${idPrefix}-payment-notes`}
              aria-label="บันทึกการจ่าย"
              type="text"
              value={payment.paymentNotes}
              onChange={(e) => onChange({ paymentNotes: e.target.value })}
              className={fieldCls}
              placeholder="เช่น เลขอ้างอิง, ชื่อบัญชี"
            />
          </div>
        )}
      </Wrap>

      {/* Attachments — only once something was paid */}
      {paid && (
        <Wrap className={wrapCls}>
          {variant === 'card' ? (
            <CardHeader icon={<Paperclip className="size-4.5" />} tone="bg-info/10 text-info" title="แนบสลิป/หลักฐาน" hint="รูปสลิปโอน หรือวางลิงก์เอกสาร" />
          ) : (
            <p className={cn(labelCls, 'mt-3')}>แนบสลิป/หลักฐาน</p>
          )}
          <div className="flex gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm text-primary hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20">
              <ImagePlus className="size-4" />
              เลือกรูป
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  files.forEach((file) => {
                    const reader = new FileReader();
                    reader.onload = () => setAttachments((prev) => [...prev, reader.result as string]);
                    reader.readAsDataURL(file);
                  });
                  e.target.value = '';
                }}
              />
            </label>
            <input
              type="text"
              aria-label="ลิงก์เอกสาร"
              value={attachmentUrl}
              onChange={(e) => setAttachmentUrl(e.target.value)}
              className={fieldCls}
              placeholder="หรือวาง URL"
            />
            <button
              type="button"
              onClick={() => {
                if (attachmentUrl.trim()) {
                  setAttachments([...attachments, attachmentUrl.trim()]);
                  setAttachmentUrl('');
                }
              }}
              className="h-10 whitespace-nowrap rounded-lg bg-secondary px-3 text-sm hover:bg-muted/50"
            >
              + เพิ่ม
            </button>
          </div>
          {attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {attachments.map((att, idx) => (
                <div key={idx} className="group relative">
                  {att.startsWith('data:image') ? (
                    <img src={att} alt={`แนบ ${idx + 1}`} className="size-16 rounded-lg border object-cover" />
                  ) : (
                    <div className="flex size-16 items-center justify-center overflow-hidden break-all rounded-lg border bg-primary/10 p-1 text-2xs text-primary dark:bg-primary/15">
                      <a href={att} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {att.length > 20 ? att.slice(0, 20) + '...' : att}
                      </a>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`เอาไฟล์แนบ ${idx + 1} ออก`}
                    onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                    className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-2xs text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </Wrap>
      )}
    </>
  );
}

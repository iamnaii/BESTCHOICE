import { Calculator, CreditCard, ImagePlus, Paperclip, Pencil, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumberDecimal, formatDateShort } from '@/utils/formatters';
import type { CreatePOModalProps } from '../CreatePOModal';
import type { ItemForm } from '../../types';
import type { PoTotals } from '../../poTotals';
import { itemLabel } from '../../po-catalog.util';
import { paymentMethodLabels } from '../../constants';

interface StepSummaryProps {
  form: CreatePOModalProps['form'];
  setForm: CreatePOModalProps['setForm'];
  items: ItemForm[];
  selectedSupplier: CreatePOModalProps['selectedSupplier'];
  supplierHasVat: boolean;
  totals: PoTotals;
  dueDatePreview: Date | null;
  attachmentUrl: string;
  setAttachmentUrl: (v: string) => void;
  formAttachments: string[];
  setFormAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  /** "แก้ไขรายการ" — jump back to the items step. */
  onEditItems: () => void;
}

const baht = (n: number) => `${formatNumberDecimal(n, 2)} บาท`;
const round2 = (n: number) => String(Math.round(n * 100) / 100);

const card = 'rounded-xl border border-border/50 bg-card p-5 shadow-sm';
const fieldCls =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-hidden placeholder:text-muted-foreground ' +
  'focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50';
const moneyInput =
  'h-9 w-36 rounded-md border border-input bg-background px-2 text-right font-mono text-sm tabular-nums outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30';
const labelCls = 'mb-1 block text-xs leading-snug text-muted-foreground';

function CardHeader({ icon, title, hint, tone }: { icon: React.ReactNode; title: string; hint: string; tone: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <div className={cn('flex size-8 items-center justify-center rounded-lg', tone)}>{icon}</div>
      <div>
        <h3 className="text-sm font-semibold leading-snug text-foreground">{title}</h3>
        <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/**
 * Last step of the 3-step wizard (owner decision 2026-09-06 "3 ขั้น พอ"): a recap of what
 * was chosen, the money breakdown with the discount inputs inline, payment, attachments
 * and notes — and the footer button submits. Replaces the old ส่วนลด/VAT + ทบทวน steps.
 */
export function StepSummary({
  form,
  setForm,
  items,
  selectedSupplier,
  supplierHasVat,
  totals,
  dueDatePreview,
  attachmentUrl,
  setAttachmentUrl,
  formAttachments,
  setFormAttachments,
  onEditItems,
}: StepSummaryProps) {
  const { subtotal, discountNum, subtotalAfterDiscount, vatAmount, totalWithVat, discountAfterVatNum, netAmount } = totals;
  const pieces = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const paid = form.paymentStatus !== 'UNPAID';
  const partial = paid && form.paymentStatus !== 'FULLY_PAID' && netAmount > 0;

  return (
    <div className="space-y-5">
      {/* Recap — who, when, what */}
      <section aria-label="สรุปใบสั่งซื้อ" className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-2xs uppercase leading-snug tracking-wider text-muted-foreground">ผู้จัดจำหน่าย</div>
            <div className="text-base font-semibold leading-snug text-foreground">{selectedSupplier?.name ?? '-'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-snug text-muted-foreground">
              <span>สั่ง {form.orderDate ? formatDateShort(form.orderDate) : '-'}</span>
              <span>คาดรับ {form.expectedDate ? formatDateShort(form.expectedDate) : '-'}</span>
              {dueDatePreview && <span>ครบกำหนดชำระ {formatDateShort(dueDatePreview)}</span>}
              {supplierHasVat && (
                <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info dark:bg-info/15">VAT 7%</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm leading-snug text-muted-foreground">
              {items.length} รายการ · {pieces} ชิ้น
            </span>
            <button
              type="button"
              onClick={onEditItems}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Pencil className="size-3.5" />
              แก้ไขรายการ
            </button>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-border/60 border-t border-border/60 text-sm">
          {items.map((i, idx) => (
            <li key={idx} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate leading-snug text-foreground">
                {itemLabel(i)} <span className="text-muted-foreground">× {i.quantity || 0}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums">{baht((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0))}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Money breakdown with the discount inputs inline */}
      <section className={card}>
        <CardHeader
          icon={<Calculator className="size-4.5" />}
          tone="bg-primary/10 text-primary"
          title="ส่วนลด และ VAT"
          hint={supplierHasVat ? 'คำนวณ VAT 7% หลังหักส่วนลด แล้วจึงหักส่วนลดหลัง VAT' : 'ผู้จัดจำหน่ายไม่มี VAT'}
        />
        <div className="space-y-2.5 rounded-lg bg-muted/50 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="leading-snug text-muted-foreground">มูลค่าสินค้า{supplierHasVat ? ' (ก่อน VAT)' : ''}</span>
            <span data-testid="subtotal" className="font-mono font-medium tabular-nums">{baht(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="leading-snug text-muted-foreground">หัก ส่วนลด{supplierHasVat ? ' (ก่อน VAT)' : ''}</span>
            <input
              aria-label="ส่วนลด"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={form.discount}
              onChange={(e) => setForm({ ...form, discount: e.target.value })}
              className={moneyInput}
            />
          </div>
          <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
            <span className="leading-snug text-muted-foreground">= มูลค่าหลังหักส่วนลด</span>
            <span className="font-mono tabular-nums">{baht(subtotalAfterDiscount)}</span>
          </div>
          {supplierHasVat && (
            <>
              <div className="flex items-center justify-between">
                <span className="leading-snug text-muted-foreground">+ VAT 7% (ปัดเศษขึ้นครึ่งสตางค์)</span>
                <span className="font-mono tabular-nums">{baht(vatAmount)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
                <span className="leading-snug text-muted-foreground">= มูลค่ารวม VAT</span>
                <span className="font-mono tabular-nums">{baht(totalWithVat)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="leading-snug text-muted-foreground">หัก ส่วนลด (หลัง VAT)</span>
                <input
                  aria-label="ส่วนลด (หลัง VAT)"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={form.discountAfterVat}
                  onChange={(e) => setForm({ ...form, discountAfterVat: e.target.value })}
                  className={moneyInput}
                />
              </div>
            </>
          )}
          <div className="mt-1 flex items-center justify-between border-t-2 border-border pt-3 text-base font-semibold">
            <span className="leading-snug">ยอดสุทธิ</span>
            <span data-testid="net-amount" className="font-mono tabular-nums text-primary">{baht(netAmount)}</span>
          </div>
          <p className="pt-1 text-2xs leading-snug text-muted-foreground">
            {supplierHasVat
              ? `วิธีคิด: (${formatNumberDecimal(subtotal, 2)} − ${formatNumberDecimal(discountNum, 2)}) × 1.07 − ${formatNumberDecimal(discountAfterVatNum, 2)} = ${formatNumberDecimal(netAmount, 2)} บาท`
              : `วิธีคิด: ${formatNumberDecimal(subtotal, 2)} − ${formatNumberDecimal(discountNum, 2)} = ${formatNumberDecimal(netAmount, 2)} บาท`}
          </p>
        </div>
      </section>

      {/* Payment */}
      <section className={card}>
        <CardHeader
          icon={<CreditCard className="size-4.5" />}
          tone="bg-warning/10 text-warning"
          title="การจ่ายเงิน"
          hint="สถานะและวิธีการชำระเงิน — เว้นไว้ได้ถ้ายังไม่จ่าย"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="po-payment-status" className={labelCls}>สถานะการจ่าย</label>
            <select
              id="po-payment-status"
              aria-label="สถานะการจ่าย"
              value={form.paymentStatus}
              onChange={(e) => {
                const status = e.target.value;
                setForm({
                  ...form,
                  paymentStatus: status,
                  paidAmount: status === 'FULLY_PAID' ? round2(netAmount) : status === 'UNPAID' ? '' : form.paidAmount,
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
            <label htmlFor="po-payment-method" className={labelCls}>วิธีจ่ายเงิน</label>
            <select
              id="po-payment-method"
              aria-label="วิธีจ่ายเงิน"
              value={form.paymentMethod}
              onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              className={fieldCls}
              disabled={!paid}
            >
              <option value="">-- เลือก --</option>
              {selectedSupplier?.paymentMethods?.length ? (
                selectedSupplier.paymentMethods.map((pm, idx) => {
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
            <label htmlFor="po-paid-amount" className={labelCls}>จำนวนที่จ่าย (บาท)</label>
            <input
              id="po-paid-amount"
              aria-label="จำนวนที่จ่าย"
              type="number"
              min="0"
              step="0.01"
              value={form.paidAmount}
              onChange={(e) => setForm({ ...form, paidAmount: e.target.value })}
              className={fieldCls}
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
                    onClick={() => setForm({ ...form, paidAmount: q.value })}
                    className="inline-flex h-7 cursor-pointer items-center rounded-full border border-input bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {paid && (
          <div className="mt-3">
            <label htmlFor="po-payment-notes" className={labelCls}>บันทึกการจ่าย</label>
            <input
              id="po-payment-notes"
              aria-label="บันทึกการจ่าย"
              type="text"
              value={form.paymentNotes}
              onChange={(e) => setForm({ ...form, paymentNotes: e.target.value })}
              className={fieldCls}
              placeholder="เช่น เลขอ้างอิง, ชื่อบัญชี"
            />
          </div>
        )}
      </section>

      {/* Attachments — only once something was paid */}
      {paid && (
        <section className={card}>
          <CardHeader
            icon={<Paperclip className="size-4.5" />}
            tone="bg-info/10 text-info"
            title="แนบสลิป/หลักฐาน"
            hint="รูปสลิปโอน หรือวางลิงก์เอกสาร"
          />
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
                    reader.onload = () => setFormAttachments((prev) => [...prev, reader.result as string]);
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
                  setFormAttachments([...formAttachments, attachmentUrl.trim()]);
                  setAttachmentUrl('');
                }
              }}
              className="h-10 whitespace-nowrap rounded-lg bg-secondary px-3 text-sm hover:bg-muted/50"
            >
              + เพิ่ม
            </button>
          </div>
          {formAttachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {formAttachments.map((att, idx) => (
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
                    onClick={() => setFormAttachments(formAttachments.filter((_, i) => i !== idx))}
                    className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-2xs text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Notes */}
      <section className={card}>
        <CardHeader
          icon={<StickyNote className="size-4.5" />}
          tone="bg-muted text-muted-foreground"
          title="หมายเหตุ"
          hint="บันทึกเพิ่มเติมสำหรับใบสั่งซื้อ"
        />
        <textarea
          aria-label="หมายเหตุ"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          className={cn(fieldCls, 'h-auto py-2')}
        />
      </section>
    </div>
  );
}

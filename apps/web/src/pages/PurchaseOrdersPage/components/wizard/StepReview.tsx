import { formatNumberDecimal, formatDateShort } from '@/utils/formatters';
import type { CreatePOModalProps } from '../CreatePOModal';
import type { ItemForm } from '../../types';
import type { PoTotals } from '../../poTotals';

interface StepReviewProps {
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
  selectClass: string;
  inputClass: string;
}

const baht = (n: number) => `${formatNumberDecimal(n, 2)} บาท`;

function itemLabel(i: ItemForm): string {
  if (i.category === 'ACCESSORY') {
    const isCharger = i.accessoryType === 'ชุดชาร์จ';
    return isCharger
      ? [i.accessoryType, i.accessoryBrand, i.model].filter(Boolean).join(' ')
      : [i.accessoryType, i.accessoryBrand, i.model ? `สำหรับ ${i.model}` : '']
          .filter(Boolean)
          .join(' ');
  }
  return [i.brand, i.model, i.color, i.storage].filter(Boolean).join(' ');
}

export function StepReview({
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
  selectClass,
  inputClass,
}: StepReviewProps) {
  const netAmount = totals.netAmount;
  return (
    <div className="space-y-5">
      {/* Read-only summary */}
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-foreground leading-snug">ทบทวนใบสั่งซื้อ</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider leading-snug">
              ผู้จัดจำหน่าย
            </div>
            <div className="text-foreground leading-snug">{selectedSupplier?.name ?? '-'}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider leading-snug">
              วันที่สั่ง
            </div>
            <div className="text-foreground leading-snug">
              {form.orderDate ? formatDateShort(form.orderDate) : '-'}
            </div>
          </div>
          {dueDatePreview && (
            <div>
              <div className="text-2xs text-muted-foreground uppercase tracking-wider leading-snug">
                ครบกำหนดชำระ
              </div>
              <div className="text-foreground leading-snug">{formatDateShort(dueDatePreview)}</div>
            </div>
          )}
        </div>
        <div className="border-t border-border/60 pt-3 space-y-1.5">
          {items.map((i, idx) => (
            <div key={idx} className="flex justify-between text-sm">
              <span className="text-muted-foreground leading-snug">
                {itemLabel(i)} × {i.quantity || 0}
              </span>
              <span className="tabular-nums font-mono">
                {baht((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0))}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-border/60 pt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground leading-snug">มูลค่าสินค้า</span>
            <span className="tabular-nums font-mono">{baht(totals.subtotal)}</span>
          </div>
          {totals.discountNum > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground leading-snug">ส่วนลด</span>
              <span className="tabular-nums font-mono">−{baht(totals.discountNum)}</span>
            </div>
          )}
          {supplierHasVat && (
            <div className="flex justify-between">
              <span className="text-muted-foreground leading-snug">VAT 7%</span>
              <span className="tabular-nums font-mono">{baht(totals.vatAmount)}</span>
            </div>
          )}
          {totals.discountAfterVatNum > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground leading-snug">ส่วนลด (หลัง VAT)</span>
              <span className="tabular-nums font-mono">−{baht(totals.discountAfterVatNum)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold text-base">
            <span className="leading-snug">ยอดสุทธิ</span>
            <span className="text-primary tabular-nums font-mono">{baht(netAmount)}</span>
          </div>
        </div>
      </div>

      {/* Section 4: Payment (orange) */}
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="20" height="14" x="2" y="5" rx="2" />
              <line x1="2" x2="22" y1="10" y2="10" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-snug">การจ่ายเงิน</h3>
            <p className="text-xs text-muted-foreground leading-snug">สถานะและวิธีการชำระเงิน</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">สถานะ</label>
            <select
              value={form.paymentStatus}
              onChange={(e) => {
                const newStatus = e.target.value;
                setForm({
                  ...form,
                  paymentStatus: newStatus,
                  paidAmount:
                    newStatus === 'FULLY_PAID'
                      ? String(Math.round(netAmount * 100) / 100)
                      : newStatus === 'UNPAID'
                        ? ''
                        : form.paidAmount,
                });
              }}
              className={selectClass}
            >
              <option value="UNPAID">ยังไม่จ่าย</option>
              <option value="DEPOSIT_PAID">จ่ายมัดจำ</option>
              <option value="PARTIALLY_PAID">จ่ายบางส่วน</option>
              <option value="FULLY_PAID">จ่ายครบแล้ว</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
              วิธีจ่ายเงิน
            </label>
            <select
              value={form.paymentMethod}
              onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              className={selectClass}
              disabled={form.paymentStatus === 'UNPAID'}
            >
              <option value="">-- เลือก --</option>
              {selectedSupplier?.paymentMethods?.length ? (
                selectedSupplier.paymentMethods.map((pm, idx) => {
                  const labels: Record<string, string> = {
                    CASH: 'เงินสด',
                    BANK_TRANSFER: 'โอนธนาคาร',
                    CHECK: 'เช็ค',
                    CREDIT: 'เครดิต',
                  };
                  const label = labels[pm.paymentMethod] || pm.paymentMethod;
                  const detail = pm.bankName
                    ? ` - ${pm.bankName}${pm.bankAccountNumber ? ` (${pm.bankAccountNumber})` : ''}`
                    : '';
                  const credit = pm.creditTermDays ? ` ${pm.creditTermDays} วัน` : '';
                  return (
                    <option key={idx} value={pm.paymentMethod}>
                      {label}
                      {detail}
                      {credit}
                      {pm.isDefault ? ' (ค่าเริ่มต้น)' : ''}
                    </option>
                  );
                })
              ) : (
                <>
                  <option value="CASH">เงินสด</option>
                  <option value="BANK_TRANSFER">โอนธนาคาร</option>
                  <option value="CHECK">เช็ค</option>
                  <option value="CREDIT">เครดิต</option>
                </>
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
              จำนวนที่จ่าย (บาท)
            </label>
            <input
              type="number"
              value={form.paidAmount}
              onChange={(e) => setForm({ ...form, paidAmount: e.target.value })}
              className={inputClass}
              min="0"
              step="0.01"
              disabled={form.paymentStatus === 'UNPAID'}
              placeholder={form.paymentStatus === 'UNPAID' ? '-' : '0'}
            />
            {form.paymentStatus !== 'UNPAID' &&
              form.paymentStatus !== 'FULLY_PAID' &&
              netAmount > 0 && (
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, paidAmount: String(Math.round(netAmount * 0.3)) })
                    }
                    className="text-xs text-primary hover:underline"
                  >
                    30%
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, paidAmount: String(Math.round(netAmount * 0.5)) })
                    }
                    className="text-xs text-primary hover:underline"
                  >
                    50%
                  </button>
                </div>
              )}
          </div>
        </div>
        {form.paymentStatus !== 'UNPAID' && (
          <div className="mt-2">
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
              หมายเหตุการจ่ายเงิน
            </label>
            <input
              type="text"
              value={form.paymentNotes}
              onChange={(e) => setForm({ ...form, paymentNotes: e.target.value })}
              className={inputClass}
              placeholder="เช่น เลขอ้างอิง, ชื่อบัญชี"
            />
          </div>
        )}
      </div>

      {/* Section 5: Attachments (sky) - only shown when payment is not UNPAID */}
      {form.paymentStatus !== 'UNPAID' && (
        <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-info/10 text-info">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground leading-snug">แนบสลิป/เอกสาร</h3>
              <p className="text-xs text-muted-foreground leading-snug">แนบหลักฐานการชำระเงิน</p>
            </div>
          </div>

          <div className="flex gap-2">
            <label className="flex items-center gap-1 px-3 py-2 bg-primary/10 text-primary border border-primary/30 rounded-lg text-xs cursor-pointer hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20 whitespace-nowrap">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
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
                    reader.onload = () => {
                      setFormAttachments((prev) => [...prev, reader.result as string]);
                    };
                    reader.readAsDataURL(file);
                  });
                  e.target.value = '';
                }}
              />
            </label>
            <input
              type="text"
              value={attachmentUrl}
              onChange={(e) => setAttachmentUrl(e.target.value)}
              className={inputClass}
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
              className="px-3 py-2 bg-secondary rounded-lg text-sm hover:bg-muted/50 whitespace-nowrap"
            >
              + เพิ่ม
            </button>
          </div>
          {formAttachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {formAttachments.map((att, idx) => (
                <div key={idx} className="relative group">
                  {att.startsWith('data:image') ? (
                    <img
                      src={att}
                      alt={`แนบ ${idx + 1}`}
                      className="h-16 w-16 object-cover rounded-lg border"
                    />
                  ) : (
                    <div className="h-16 w-16 flex items-center justify-center bg-primary/10 dark:bg-primary/15 rounded-lg border text-2xs text-primary p-1 break-all overflow-hidden">
                      <a
                        href={att}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {att.length > 20 ? att.slice(0, 20) + '...' : att}
                      </a>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setFormAttachments(formAttachments.filter((_, i) => i !== idx))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-destructive-foreground rounded-full text-2xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notes - simple field at the bottom */}
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" x2="8" y1="13" y2="13" />
              <line x1="16" x2="8" y1="17" y2="17" />
              <line x1="10" x2="8" y1="9" y2="9" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-snug">หมายเหตุ</h3>
            <p className="text-xs text-muted-foreground leading-snug">
              บันทึกเพิ่มเติมสำหรับใบสั่งซื้อ
            </p>
          </div>
        </div>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          className={inputClass}
        />
      </div>
    </div>
  );
}

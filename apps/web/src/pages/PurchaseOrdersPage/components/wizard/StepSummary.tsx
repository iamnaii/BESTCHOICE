import { Calculator, Pencil, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumberDecimal, formatDateShort } from '@/utils/formatters';
import type { CreatePOModalProps } from '../CreatePOModal';
import type { ItemForm } from '../../types';
import type { PoTotals } from '../../poTotals';
import { itemLabel } from '../../po-catalog.util';
import { PaymentSection } from './PaymentSection';
import { CardHeader, card, fieldCls, moneyInput } from './chrome';

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
  /** รับเข้าตรง: the recap says "รับเข้าวันนี้" + ผ่าน/ไม่ผ่าน instead of สั่ง/คาดรับ. */
  receive?: { passed: number; rejected: number };
}

const baht = (n: number) => `${formatNumberDecimal(n, 2)} บาท`;

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
  receive,
}: StepSummaryProps) {
  const { subtotal, discountNum, subtotalAfterDiscount, vatAmount, totalWithVat, discountAfterVatNum, netAmount } = totals;
  const pieces = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);

  return (
    <div className="space-y-5">
      {/* Recap — who, when, what */}
      <section aria-label="สรุปใบสั่งซื้อ" className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-2xs uppercase leading-snug tracking-wider text-muted-foreground">ผู้จัดจำหน่าย</div>
            <div className="text-base font-semibold leading-snug text-foreground">{selectedSupplier?.name ?? '-'}</div>
            {!selectedSupplier && (
              <p role="alert" className="mt-1 text-xs leading-snug text-destructive">
                ไม่พบผู้จัดจำหน่ายที่บันทึกไว้ในร่าง — กลับไปเลือกใหม่ที่ขั้น &quot;เลือกผู้ขาย&quot;
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-snug text-muted-foreground">
              {receive ? (
                <span>รับเข้าวันนี้ {form.orderDate ? formatDateShort(form.orderDate) : '-'}</span>
              ) : (
                <>
                  <span>สั่ง {form.orderDate ? formatDateShort(form.orderDate) : '-'}</span>
                  <span>คาดรับ {form.expectedDate ? formatDateShort(form.expectedDate) : '-'}</span>
                </>
              )}
              {dueDatePreview && <span>ครบกำหนดชำระ {formatDateShort(dueDatePreview)}</span>}
              {supplierHasVat && (
                <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info dark:bg-info/15">VAT 7%</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm leading-snug text-muted-foreground">
              {items.length} รายการ · {pieces} ชิ้น
              {receive && (
                <>
                  {' · '}
                  <span className="font-medium text-success">ผ่าน {receive.passed} ชิ้น</span>
                  {receive.rejected > 0 && <span className="font-medium text-destructive"> · ไม่ผ่าน {receive.rejected} ชิ้น</span>}
                </>
              )}
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

      {/* Payment + slips — shared block (also used by the approve dialog) */}
      <PaymentSection
        payment={form}
        onChange={(patch) => setForm({ ...form, ...patch })}
        netAmount={netAmount}
        paymentMethods={selectedSupplier?.paymentMethods}
        attachmentUrl={attachmentUrl}
        setAttachmentUrl={setAttachmentUrl}
        attachments={formAttachments}
        setAttachments={setFormAttachments}
        idPrefix="po"
        unpaidNote={dueDatePreview ? `ซื้อเครดิต — ครบกำหนดชำระ ${formatDateShort(dueDatePreview)} บันทึกการจ่ายทีหลังได้จากปุ่ม "จ่ายเงิน" ของใบนี้` : undefined}
      />

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

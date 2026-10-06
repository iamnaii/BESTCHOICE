import { Link } from 'react-router';
import { Receipt, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { canSeeInputVat, INPUT_VAT_AGE_WARN_MONTHS, type ContractInputVat } from '@/lib/input-vat';

interface Props {
  inputVat?: ContractInputVat | null;
  role?: string | null;
}

const STATUS_LABEL = {
  CLAIMED: { text: 'เคลมแล้ว', variant: 'success' as const },
  PENDING_INVOICE: { text: 'รอใบกำกับภาษี', variant: 'warning' as const },
  NOT_ELIGIBLE: { text: 'ไม่มีภาษีซื้อ', variant: 'secondary' as const },
  REVERSED: { text: 'กลับรายการแล้ว (ยกเลิกสัญญา)', variant: 'outline' as const },
};

/**
 * ก้อน 5 — ภาษีซื้อของเครื่องหลักที่ FINANCE เคลม (Dr 11-4101 / Cr 42-1108) · เห็นเฉพาะ OWNER/FM/ACCOUNTANT (Q5)
 * สถานะ NONE (สัญญาก่อนก้อน 5 / ร่าง) ไม่แสดง
 */
export default function ContractInputVatCard({ inputVat, role }: Props) {
  if (!inputVat || inputVat.status === 'NONE' || !canSeeInputVat(role)) return null;
  const label = STATUS_LABEL[inputVat.status];
  const receivingHref =
    inputVat.poId && inputVat.receivingId ? `/purchase-orders/${inputVat.poId}/goods-receivings/${inputVat.receivingId}/print` : null;
  const ageWarn = !!inputVat.taxInvoice && inputVat.taxInvoice.ageMonths >= INPUT_VAT_AGE_WARN_MONTHS;

  return (
    <section aria-label="ภาษีซื้อของเครื่อง" className="rounded-xl border border-border/50 bg-card p-5 shadow-sm mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground leading-snug">ภาษีซื้อของเครื่อง (สมุดไฟแนนซ์)</h2>
        </div>
        <Badge variant={label.variant} appearance="light">{label.text}</Badge>
      </div>

      {inputVat.status === 'NOT_ELIGIBLE' ? (
        <p className="text-sm text-muted-foreground leading-snug">{inputVat.reason ?? 'ไม่เข้าเงื่อนไขเคลมภาษีซื้อ'}</p>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {inputVat.amount && (
            <div>
              <dt className="text-xs text-muted-foreground">{inputVat.status === 'PENDING_INVOICE' ? 'ยอดที่จะเคลม' : 'ยอดภาษีซื้อ'}</dt>
              <dd className="font-mono tabular-nums font-semibold">{formatNumberDecimal(inputVat.amount, 2)} ฿</dd>
            </div>
          )}
          {inputVat.journalEntryNo && (
            <div>
              <dt className="text-xs text-muted-foreground">รายการบัญชี (Dr 11-4101 / Cr 42-1108)</dt>
              <dd className="font-mono">{inputVat.journalEntryNo}</dd>
            </div>
          )}
          {inputVat.taxInvoice && (
            <div>
              <dt className="text-xs text-muted-foreground">ใบกำกับภาษี</dt>
              <dd className="leading-snug">{inputVat.taxInvoice.number} · ลงวันที่ {formatDateShort(inputVat.taxInvoice.date)}</dd>
            </div>
          )}
          {inputVat.grNumber && (
            <div>
              <dt className="text-xs text-muted-foreground">ใบรับของ</dt>
              <dd>
                {receivingHref ? (
                  <Link to={receivingHref} className="text-primary hover:underline">ดูใบรับของ {inputVat.grNumber}</Link>
                ) : (
                  inputVat.grNumber
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {inputVat.status === 'PENDING_INVOICE' && (
        <p className="mt-3 text-xs text-muted-foreground leading-snug">
          ใบรับของยังไม่มีใบกำกับภาษี — บันทึกใบกำกับภาษีได้ที่หน้าใบสั่งซื้อ {inputVat.poNumber ?? ''} เมื่อได้รับ ระบบจะเคลมย้อนลงวันเปิดสัญญาให้เอง
        </p>
      )}
      {ageWarn && inputVat.taxInvoice && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-warning-strong leading-snug">
          <AlertTriangle className="size-3.5" aria-hidden />
          ใบกำกับอายุ {inputVat.taxInvoice.ageMonths} เดือน — เกิน {INPUT_VAT_AGE_WARN_MONTHS} เดือน ตรวจกับฝ่ายบัญชี
        </p>
      )}
    </section>
  );
}

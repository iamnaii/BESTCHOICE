// Fix Report v1.0 P1-2 — Payment Voucher A4 print
//
// Routes:
//   /expenses/:id/voucher       → ใบสำคัญจ่าย A4 (print-friendly)
//
// Renders an official-looking voucher: company header + doc meta + items table
// + auto-journal table + amount-in-thai-text + 4 signature slots + (when WHT > 0)
// an additional "ใบรับรองการหักภาษี ณ ที่จ่าย (ม.50 ทวิ)" mini-form.
//
// `window.print()` uses @media print CSS to hide screen-only chrome and
// flow at A4. Browser print dialog handles PDF export.

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { formatNumberDecimal } from '@/utils/formatters';
import { formatThaiDateLong } from '@/lib/date';
import { numToThaiText } from '@/utils/numToThaiText';

interface ExpenseLine {
  lineNo: number;
  category: string;
  description: string | null;
  quantity: string;
  unitPrice: string;
  amountBeforeVat: string;
  vatAmount: string;
  whtAmount: string;
}

interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

interface VoucherDoc {
  id: string;
  number: string;
  documentDate: string;
  vendorName: string | null;
  vendorTaxId: string | null;
  taxInvoiceNo: string | null;
  description: string | null;
  subtotal: string;
  vatAmount: string;
  withholdingTax: string;
  whtFormType: string | null;
  totalAmount: string;
  netPayment: string | null;
  depositAccountCode: string | null;
  status: string;
  reference: string | null;
  note: string | null;
  expenseDetail: { lines: ExpenseLine[] } | null;
  journalLines?: JournalLine[];
}

export default function PaymentVoucherPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const docQuery = useQuery<VoucherDoc>({
    queryKey: ['expense-doc-voucher', id],
    queryFn: async () => {
      const { data } = await api.get(`/expense-documents/${id}`);
      return data;
    },
    enabled: !!id,
  });

  // Render to print as soon as data loads + user has clicked print (not auto).
  // No auto-print — owner asked for explicit button.

  useEffect(() => {
    document.title = docQuery.data
      ? `ใบสำคัญจ่าย ${docQuery.data.number}`
      : 'ใบสำคัญจ่าย';
  }, [docQuery.data]);

  return (
    <div className="bg-muted/30 min-h-screen">
      {/* Screen-only header (hidden on print via .no-print) */}
      <div className="no-print bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-[210mm] mx-auto px-6 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} />
            กลับ
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Printer size={14} />
            พิมพ์ / Save PDF
          </button>
        </div>
      </div>

      <QueryBoundary
        isLoading={docQuery.isLoading}
        isError={docQuery.isError}
        error={docQuery.error}
        onRetry={docQuery.refetch}
      >
        {docQuery.data && <VoucherSheet doc={docQuery.data} />}
      </QueryBoundary>

      {/* Print CSS lives co-located with the page */}
      <style>{`
        @page { size: A4; margin: 14mm 12mm; }
        @media print {
          .no-print { display: none !important; }
          .voucher-sheet { box-shadow: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}

function VoucherSheet({ doc }: { doc: VoucherDoc }) {
  const hasWht = parseFloat(doc.withholdingTax || '0') > 0;
  const net = doc.netPayment ?? doc.totalAmount;
  const amountText = numToThaiText(parseFloat(net));

  return (
    <div className="max-w-[210mm] mx-auto py-6 px-6 print:px-0 print:py-0 space-y-6">
      <Sheet doc={doc} amountInText={amountText} net={net} />
      {hasWht && <WhtCertificate doc={doc} />}
    </div>
  );
}

function Sheet({
  doc,
  amountInText,
  net,
}: {
  doc: VoucherDoc;
  amountInText: string;
  net: string;
}) {
  const lines = doc.expenseDetail?.lines ?? [];
  return (
    <article
      className="voucher-sheet bg-white border border-border rounded-md p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
      style={{ minHeight: '270mm' }}
    >
      {/* Company header */}
      <header className="text-center border-b-2 border-foreground pb-3">
        <h1 className="text-xl font-bold">BESTCHOICE FINANCE × SHOP</h1>
        <p className="text-sm text-muted-foreground mt-1">
          เลขประจำตัวผู้เสียภาษี · สำนักงานใหญ่
        </p>
        <h2 className="text-2xl font-bold tracking-wider mt-4">ใบสำคัญจ่าย</h2>
        <p className="text-xs text-muted-foreground">Payment Voucher</p>
      </header>

      {/* Meta */}
      <section className="grid grid-cols-2 gap-x-8 gap-y-2 mt-5 text-sm">
        <MetaRow label="เลขที่เอกสาร" value={doc.number} mono />
        <MetaRow label="วันที่" value={formatThaiDateLong(doc.documentDate)} />
        <MetaRow label="ผู้ขาย / บริษัท" value={doc.vendorName ?? '—'} />
        <MetaRow label="เลขผู้เสียภาษี" value={doc.vendorTaxId ?? '—'} mono />
        <MetaRow label="เลขใบกำกับภาษี" value={doc.taxInvoiceNo ?? '—'} mono />
        <MetaRow label="ช่องทางชำระ" value={doc.depositAccountCode ?? '—'} mono />
        {doc.description && (
          <div className="col-span-2">
            <MetaRow label="คำอธิบาย" value={doc.description} />
          </div>
        )}
      </section>

      {/* Item lines */}
      <table className="w-full mt-6 text-xs border border-border">
        <thead className="bg-muted/40">
          <tr>
            <th className="border border-border p-2 text-left w-10">#</th>
            <th className="border border-border p-2 text-left">หมวดบัญชี</th>
            <th className="border border-border p-2 text-left">รายการ</th>
            <th className="border border-border p-2 text-right w-16">จำนวน</th>
            <th className="border border-border p-2 text-right w-24">ราคาต่อหน่วย</th>
            <th className="border border-border p-2 text-right w-24">ก่อน VAT</th>
            <th className="border border-border p-2 text-right w-20">VAT</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={7} className="border border-border p-3 text-center text-muted-foreground">
                ไม่มีรายการ
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="border border-border p-2 tabular-nums">{l.lineNo}</td>
                <td className="border border-border p-2 font-mono">{l.category}</td>
                <td className="border border-border p-2">{l.description ?? '—'}</td>
                <td className="border border-border p-2 text-right tabular-nums">
                  {formatNumberDecimal(l.quantity)}
                </td>
                <td className="border border-border p-2 text-right tabular-nums">
                  {formatNumberDecimal(l.unitPrice)}
                </td>
                <td className="border border-border p-2 text-right tabular-nums">
                  {formatNumberDecimal(l.amountBeforeVat)}
                </td>
                <td className="border border-border p-2 text-right tabular-nums">
                  {formatNumberDecimal(l.vatAmount)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Totals */}
      <section className="grid grid-cols-2 gap-6 mt-5">
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <p className="text-xs text-muted-foreground mb-1">จำนวนเงิน (ตัวอักษร)</p>
          <p className="font-semibold leading-relaxed">{amountInText}</p>
        </div>
        <table className="text-sm">
          <tbody>
            <TotalRow label="ยอดรวมก่อน VAT" value={doc.subtotal} />
            <TotalRow label="VAT 7%" value={doc.vatAmount} />
            <TotalRow label="รวมก่อนหัก WHT" value={doc.totalAmount} bold />
            <TotalRow label="หัก ณ ที่จ่าย" value={doc.withholdingTax} negative />
            <TotalRow label="ยอดสุทธิที่จ่าย" value={net} bold highlight />
          </tbody>
        </table>
      </section>

      {/* Auto Journal preview — optional, embedded so accounting team can verify */}
      {doc.journalLines && doc.journalLines.length > 0 && (
        <section className="mt-6">
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Auto Journal
          </p>
          <table className="w-full text-xs border border-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="border border-border p-2 text-left">บัญชี</th>
                <th className="border border-border p-2 text-left">ชื่อบัญชี</th>
                <th className="border border-border p-2 text-right w-24">Dr (฿)</th>
                <th className="border border-border p-2 text-right w-24">Cr (฿)</th>
              </tr>
            </thead>
            <tbody>
              {doc.journalLines.map((l, i) => (
                <tr key={i}>
                  <td className="border border-border p-2 font-mono">{l.accountCode}</td>
                  <td className="border border-border p-2">{l.accountName}</td>
                  <td className="border border-border p-2 text-right tabular-nums">
                    {parseFloat(l.debit) > 0 ? formatNumberDecimal(l.debit) : '—'}
                  </td>
                  <td className="border border-border p-2 text-right tabular-nums">
                    {parseFloat(l.credit) > 0 ? formatNumberDecimal(l.credit) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Note */}
      {doc.note && (
        <section className="mt-6">
          <p className="text-xs text-muted-foreground mb-1">หมายเหตุ</p>
          <p className="text-sm">{doc.note}</p>
        </section>
      )}

      {/* Signature grid */}
      <section className="grid grid-cols-4 gap-6 mt-12">
        <SignatureSlot label="ผู้จัดทำ" />
        <SignatureSlot label="ผู้อนุมัติ" />
        <SignatureSlot label="ผู้รับเงิน" />
        <SignatureSlot label="ตราประทับ" border={false} />
      </section>

      <footer className="mt-8 pt-3 border-t border-border text-[10px] text-muted-foreground flex justify-between">
        <span>ออกเอกสารจากระบบ BESTCHOICE — ไม่ต้องเซ็นต์ถือเป็นโมฆะ</span>
        <span>ใบสำคัญจ่ายแบบฟอร์ม v1.0</span>
      </footer>
    </article>
  );
}

function WhtCertificate({ doc }: { doc: VoucherDoc }) {
  const wht = parseFloat(doc.withholdingTax);
  const subtotal = parseFloat(doc.subtotal);
  const whtPercent = subtotal > 0 ? (wht / subtotal) * 100 : 0;
  const formLabel = doc.whtFormType === 'PND53' ? 'ภ.ง.ด. 53' : 'ภ.ง.ด. 3';
  return (
    <article
      className="voucher-sheet bg-white border border-border rounded-md p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
      style={{ minHeight: '270mm', pageBreakBefore: 'always' }}
    >
      <header className="text-center border-b-2 border-foreground pb-3">
        <h1 className="text-lg font-bold">ใบรับรองการหักภาษี ณ ที่จ่าย</h1>
        <p className="text-xs text-muted-foreground mt-1">
          ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร — แบบ {formLabel}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-x-8 gap-y-3 mt-6 text-sm">
        <div>
          <p className="text-xs text-muted-foreground mb-1">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</p>
          <p className="font-semibold">BESTCHOICE FINANCE × SHOP</p>
          <p className="text-xs text-muted-foreground">เลขประจำตัวผู้เสียภาษี · สำนักงานใหญ่</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">ผู้ถูกหัก ณ ที่จ่าย</p>
          <p className="font-semibold">{doc.vendorName ?? '—'}</p>
          <p className="text-xs text-muted-foreground font-mono">{doc.vendorTaxId ?? '—'}</p>
        </div>
        <MetaRow label="วันที่จ่ายเงิน" value={formatThaiDateLong(doc.documentDate)} />
        <MetaRow label="เลขที่ใบสำคัญจ่าย" value={doc.number} mono />
      </section>

      <table className="w-full mt-8 text-sm border border-border">
        <thead className="bg-muted/40">
          <tr>
            <th className="border border-border p-2 text-left">ประเภทเงินได้</th>
            <th className="border border-border p-2 text-right w-32">จำนวนเงิน (฿)</th>
            <th className="border border-border p-2 text-right w-24">อัตรา (%)</th>
            <th className="border border-border p-2 text-right w-32">ภาษีหัก (฿)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-border p-2">
              ค่าบริการ / ค่าจ้าง (ตาม {formLabel})
            </td>
            <td className="border border-border p-2 text-right tabular-nums">
              {formatNumberDecimal(doc.subtotal)}
            </td>
            <td className="border border-border p-2 text-right tabular-nums">
              {whtPercent.toFixed(2)}
            </td>
            <td className="border border-border p-2 text-right tabular-nums">
              {formatNumberDecimal(doc.withholdingTax)}
            </td>
          </tr>
          <tr className="bg-muted/30">
            <td className="border border-border p-2 font-semibold">รวม</td>
            <td className="border border-border p-2 text-right tabular-nums font-semibold">
              {formatNumberDecimal(doc.subtotal)}
            </td>
            <td className="border border-border p-2"></td>
            <td className="border border-border p-2 text-right tabular-nums font-bold">
              {formatNumberDecimal(doc.withholdingTax)}
            </td>
          </tr>
        </tbody>
      </table>

      <section className="mt-6 rounded-md border border-border bg-muted/20 p-4 text-sm">
        <p className="text-xs text-muted-foreground mb-1">ภาษีที่หักเป็นเงิน (ตัวอักษร)</p>
        <p className="font-semibold leading-relaxed">{numToThaiText(wht)}</p>
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        ขอรับรองว่ารายการดังกล่าวข้างต้นเป็นความจริง — ผู้จ่ายเงินมีหน้าที่นำส่งภาษีต่อกรมสรรพากร
        ภายในวันที่ 7 ของเดือนถัดไป
      </p>

      <section className="grid grid-cols-2 gap-6 mt-12">
        <SignatureSlot label="ผู้จ่ายเงิน / ผู้มีหน้าที่หักภาษี" />
        <SignatureSlot label="ผู้รับเงิน" />
      </section>
    </article>
  );
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</p>
    </div>
  );
}

function TotalRow({
  label,
  value,
  bold = false,
  highlight = false,
  negative = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <tr className={highlight ? 'bg-primary/5' : ''}>
      <td className="py-1 pr-3 text-muted-foreground text-right">{label}</td>
      <td
        className={
          'py-1 pl-3 text-right tabular-nums w-32 ' +
          (bold ? 'font-bold ' : '') +
          (highlight ? 'text-primary text-lg ' : '') +
          (negative ? 'text-destructive' : '')
        }
      >
        {negative && '−'}
        {formatNumberDecimal(value)}
      </td>
    </tr>
  );
}

function SignatureSlot({ label, border = true }: { label: string; border?: boolean }) {
  return (
    <div className="text-center">
      <div
        className={
          'h-16 mb-2 ' + (border ? 'border-b border-foreground' : 'border-b border-dashed border-muted-foreground')
        }
      ></div>
      <p className="text-xs text-muted-foreground">({label})</p>
      <p className="text-[10px] text-muted-foreground mt-1">วันที่ ___ / ___ / ______</p>
    </div>
  );
}

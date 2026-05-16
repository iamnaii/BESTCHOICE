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
import { QRCodeSVG } from 'qrcode.react';
import Decimal from 'decimal.js';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { formatNumberDecimal } from '@/utils/formatters';
import { formatThaiDateLong } from '@/lib/date';
import { numToThaiText } from '@/utils/numToThaiText';
import {
  useCompanyDisplayName,
  useCompanyAddress,
  useCompanyTaxId,
  useCompanyLogoUrl,
} from '@/hooks/useCompanyInfo';
import { useUiFlags } from '@/hooks/useUiFlags';

export interface ExpenseLine {
  lineNo: number;
  category: string;
  description: string | null;
  quantity: string;
  unitPrice: string;
  amountBeforeVat: string;
  vatAmount: string;
  whtAmount: string;
  // W7 — used by WhtCertificate to render a per-rate breakdown so the form
  // 50 ทวิ requirement (itemize the WHT rate per income type) is met when a
  // single document mixes vendors with different rates.
  whtPercent?: string;
  // C1 — Petty Cash carries supplier per line (relaxes 1-doc-1-supplier).
  // Null for non-petty doc types.
  supplierName?: string | null;
}

interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

/**
 * C2.7 — Payroll slip line with per-employee custom income/deduction.
 * Optional fields populated only for PAYROLL docs.
 */
export interface PayrollSlipLine {
  id: string;
  employeeName: string;
  employeeTaxId: string | null;
  baseSalary: string;
  ssoEmployee: string;
  whtAmount: string;
  netPaid: string;
  customIncome?: Array<{
    id: string;
    accountCode: string;
    name: string;
    amount: string;
    isTaxable: boolean;
  }>;
  customDeduction?: Array<{
    id: string;
    accountCode: string;
    name: string;
    amount: string;
  }>;
}

interface VoucherDoc {
  id: string;
  number: string;
  /**
   * Branches voucher layout:
   *   - PETTY_CASH_REIMBURSEMENT — compact multi-supplier sheet (C1.8)
   *   - PAYROLL — one A4 slip per employee (C2.7)
   *   - All others — standard ใบสำคัญจ่าย
   */
  documentType:
    | 'EXPENSE'
    | 'CREDIT_NOTE'
    | 'PAYROLL'
    | 'VENDOR_SETTLEMENT'
    | 'PETTY_CASH_REIMBURSEMENT';
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
  // C2.7 — Payroll slip data (populated only for PAYROLL docs).
  payroll?: {
    payrollPeriod: string;
    lines: PayrollSlipLine[];
  } | null;
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
    const data = docQuery.data;
    if (!data) {
      document.title = 'ใบสำคัญจ่าย';
      return;
    }
    let title: string;
    if (data.documentType === 'PETTY_CASH_REIMBURSEMENT') {
      title = `ใบเบิกชดเชยเงินสดย่อย ${data.number}`;
    } else if (data.documentType === 'PAYROLL') {
      title = `ใบจ่ายเงินเดือน ${data.number}`;
    } else {
      title = `ใบสำคัญจ่าย ${data.number}`;
    }
    document.title = title;
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
  const isPettyCash = doc.documentType === 'PETTY_CASH_REIMBURSEMENT';
  const isPayroll = doc.documentType === 'PAYROLL';
  const hasWht = parseFloat(doc.withholdingTax || '0') > 0;
  const net = doc.netPayment ?? doc.totalAmount;
  const amountText = numToThaiText(parseFloat(net));

  // C1.8 — Petty Cash uses its own compact sheet (no WHT, multi-supplier table,
  // no signature grid per spec). All other doc types fall through to the
  // standard ใบสำคัญจ่าย layout.
  if (isPettyCash) {
    return (
      <div className="max-w-[210mm] mx-auto py-6 px-6 print:px-0 print:py-0 space-y-6">
        <PettyCashSheet doc={doc} amountInText={amountText} net={net} />
      </div>
    );
  }

  // C2.7 — Payroll renders one A4 slip per employee. Each slip = own
  // ใบจ่ายเงินเดือน with base + custom income + custom deduction + SSO + WHT
  // + net + Thai-text + 2 signature slots. Browser `print()` will paginate.
  if (isPayroll && doc.payroll && doc.payroll.lines.length > 0) {
    return (
      <div className="max-w-[210mm] mx-auto py-6 px-6 print:px-0 print:py-0 space-y-6">
        {doc.payroll.lines.map((line, idx) => (
          <PayrollSlipSheet
            key={line.id}
            doc={doc}
            line={line}
            slipNo={idx + 1}
            totalSlips={doc.payroll!.lines.length}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-[210mm] mx-auto py-6 px-6 print:px-0 print:py-0 space-y-6">
      <Sheet doc={doc} amountInText={amountText} net={net} />
      {hasWht && <WhtCertificate doc={doc} />}
    </div>
  );
}

/**
 * C1.8 — Petty Cash voucher sheet (mockup 04B).
 * Differences vs standard ใบสำคัญจ่าย:
 *   - title: "ใบเบิกชดเชยเงินสดย่อย"
 *   - meta: custodian (from doc.vendorName which we repurpose at backend) instead of vendor
 *   - item table: per-row supplier column; no WHT column
 *   - totals: drop WHT row
 *   - no WHT certificate
 *   - no signature grid (mockup 04B: signed inline in description, no formal sigs)
 */
function PettyCashSheet({
  doc,
  amountInText,
  net,
}: {
  doc: VoucherDoc;
  amountInText: string;
  net: string;
}) {
  const companyName = useCompanyDisplayName();
  const companyAddress = useCompanyAddress();
  const companyTaxId = useCompanyTaxId();
  const companyLogoUrl = useCompanyLogoUrl();
  const lines = doc.expenseDetail?.lines ?? [];
  // Distinct supplier count for the badge — useful auditing surface since
  // petty cash is the only doc type that mixes vendors per document.
  const supplierCount = new Set(
    lines.map((l) => (l.supplierName ?? '').trim()).filter(Boolean),
  ).size;
  return (
    <article
      className="voucher-sheet bg-white border border-border rounded-md p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
      style={{ minHeight: '270mm' }}
    >
      <header className="text-center border-b-2 border-foreground pb-3">
        {companyLogoUrl && (
          <img
            src={companyLogoUrl}
            alt={companyName}
            className="mx-auto mb-2 h-12 w-auto object-contain"
          />
        )}
        <h1 className="text-xl font-bold">{companyName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {companyAddress}{companyTaxId && ` · เลขผู้เสียภาษี ${companyTaxId}`}
        </p>
        <h2 className="text-2xl font-bold tracking-wider mt-4">ใบเบิกชดเชยเงินสดย่อย</h2>
        <p className="text-xs text-muted-foreground">Petty Cash Reimbursement Voucher</p>
      </header>

      <section className="grid grid-cols-2 gap-x-8 gap-y-2 mt-5 text-sm">
        <MetaRow label="เลขที่เอกสาร" value={doc.number} mono />
        <MetaRow label="วันที่" value={formatThaiDateLong(doc.documentDate)} />
        <MetaRow label="ผู้ดูแลเงินสดย่อย" value={doc.vendorName ?? '—'} />
        <MetaRow label="บัญชีเงินสดย่อย" value={doc.depositAccountCode ?? '—'} mono />
        <MetaRow label="จำนวนผู้ขาย" value={`${supplierCount} ราย · ${lines.length} รายการ`} />
        <MetaRow label="สถานะ" value={doc.status} mono />
        {doc.description && (
          <div className="col-span-2">
            <MetaRow label="คำอธิบาย" value={doc.description} />
          </div>
        )}
      </section>

      <table className="w-full mt-6 text-xs border border-border">
        <thead className="bg-muted/40">
          <tr>
            <th className="border border-border p-2 text-left w-10">#</th>
            <th className="border border-border p-2 text-left">ผู้ขาย/ผู้รับเงิน</th>
            <th className="border border-border p-2 text-left">หมวดบัญชี</th>
            <th className="border border-border p-2 text-left">รายละเอียด</th>
            <th className="border border-border p-2 text-right w-24">ก่อน VAT</th>
            <th className="border border-border p-2 text-right w-20">VAT</th>
            <th className="border border-border p-2 text-right w-24">รวม</th>
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
            lines.map((l) => {
              const base = parseFloat(l.amountBeforeVat || '0');
              const vat = parseFloat(l.vatAmount || '0');
              return (
                <tr key={l.lineNo}>
                  <td className="border border-border p-2 tabular-nums">{l.lineNo}</td>
                  <td className="border border-border p-2">{l.supplierName ?? '—'}</td>
                  <td className="border border-border p-2 font-mono">{l.category}</td>
                  <td className="border border-border p-2">{l.description ?? '—'}</td>
                  <td className="border border-border p-2 text-right tabular-nums">
                    {formatNumberDecimal(l.amountBeforeVat)}
                  </td>
                  <td className="border border-border p-2 text-right tabular-nums">
                    {vat > 0 ? formatNumberDecimal(l.vatAmount) : '—'}
                  </td>
                  <td className="border border-border p-2 text-right tabular-nums">
                    {formatNumberDecimal((base + vat).toString())}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <section className="grid grid-cols-2 gap-6 mt-5">
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <p className="text-xs text-muted-foreground mb-1">จำนวนเงิน (ตัวอักษร)</p>
          <p className="font-semibold leading-relaxed">{amountInText}</p>
        </div>
        <table className="text-sm">
          <tbody>
            <TotalRow label="ยอดรวมก่อน VAT" value={doc.subtotal} />
            <TotalRow label="VAT 7%" value={doc.vatAmount} />
            <TotalRow label="รวมที่เบิก" value={net} bold highlight />
          </tbody>
        </table>
      </section>

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

      {doc.note && (
        <section className="mt-6">
          <p className="text-xs text-muted-foreground mb-1">หมายเหตุ</p>
          <p className="text-sm">{doc.note}</p>
        </section>
      )}

      <footer className="mt-8 pt-3 border-t border-border text-[10px] text-muted-foreground flex justify-between">
        <span>ออกเอกสารจากระบบ BESTCHOICE — ไม่ต้องเซ็นต์ถือเป็นโมฆะ</span>
        <span>ใบเบิกชดเชยเงินสดย่อย v1.0</span>
      </footer>
    </article>
  );
}

/**
 * C2.7 — Payroll slip per employee. One A4 sheet per `PayrollSlipLine`.
 * `pageBreakBefore: 'always'` from slip #2 onwards so the browser print
 * dialog renders one slip per page. Email dispatch deferred to follow-up
 * (involves Mailer service + employee email column on PayrollLine).
 *
 * Layout (mockup 02B Payroll Slip):
 *   - Company header
 *   - Title: ใบจ่ายเงินเดือน + slip n/N
 *   - Employee meta (name, tax ID, period, doc no)
 *   - Earnings table: base + custom income (with ม.42 flag if non-taxable)
 *   - Deductions table: SSO + WHT + custom deduction
 *   - Net paid + Thai-text amount
 *   - 2 signature slots (ผู้รับเงิน · ผู้จัดทำ)
 */
function PayrollSlipSheet({
  doc,
  line,
  slipNo,
  totalSlips,
}: {
  doc: VoucherDoc;
  line: PayrollSlipLine;
  slipNo: number;
  totalSlips: number;
}) {
  const companyName = useCompanyDisplayName();
  const companyAddress = useCompanyAddress();
  const companyTaxId = useCompanyTaxId();
  const companyLogoUrl = useCompanyLogoUrl();
  const base = new Decimal(line.baseSalary || '0');
  const sso = new Decimal(line.ssoEmployee || '0');
  const wht = new Decimal(line.whtAmount || '0');
  const net = new Decimal(line.netPaid || '0');
  const customIncome = line.customIncome ?? [];
  const customDeduction = line.customDeduction ?? [];

  const sumIncome = customIncome.reduce<Decimal>(
    (s, r) => s.plus(new Decimal(r.amount || '0')),
    new Decimal(0),
  );
  const sumDeduction = customDeduction.reduce<Decimal>(
    (s, r) => s.plus(new Decimal(r.amount || '0')),
    new Decimal(0),
  );
  // Earnings = base + Σ custom income (the gross-up)
  const earningsTotal = base.plus(sumIncome);
  // Deductions = SSO + WHT + Σ custom deduction
  const deductionsTotal = sso.plus(wht).plus(sumDeduction);

  const amountInText = numToThaiText(parseFloat(line.netPaid));

  return (
    <article
      className="voucher-sheet bg-white border border-border rounded-md p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
      style={{
        minHeight: '270mm',
        pageBreakBefore: slipNo > 1 ? 'always' : 'auto',
      }}
    >
      <header className="text-center border-b-2 border-foreground pb-3">
        {companyLogoUrl && (
          <img
            src={companyLogoUrl}
            alt={companyName}
            className="mx-auto mb-2 h-12 w-auto object-contain"
          />
        )}
        <h1 className="text-xl font-bold">{companyName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {companyAddress}{companyTaxId && ` · เลขผู้เสียภาษี ${companyTaxId}`}
        </p>
        <h2 className="text-2xl font-bold tracking-wider mt-4">ใบจ่ายเงินเดือน</h2>
        <p className="text-xs text-muted-foreground">
          Payroll Slip {slipNo}/{totalSlips}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-x-8 gap-y-2 mt-5 text-sm">
        <MetaRow label="ชื่อพนักงาน" value={line.employeeName} />
        <MetaRow label="เลขประจำตัวผู้เสียภาษี" value={line.employeeTaxId ?? '—'} mono />
        <MetaRow label="งวด" value={doc.payroll?.payrollPeriod ?? '—'} mono />
        <MetaRow label="วันที่จ่าย" value={formatThaiDateLong(doc.documentDate)} />
        <MetaRow label="เลขที่เอกสารต้นทาง" value={doc.number} mono />
        <MetaRow label="ช่องทางจ่าย" value={doc.depositAccountCode ?? '—'} mono />
      </section>

      {/* Earnings */}
      <section className="mt-6">
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          รายได้ (Earnings)
        </p>
        <table className="w-full text-sm border border-border">
          <tbody>
            <tr>
              <td className="border border-border p-2">เงินเดือนพื้นฐาน</td>
              <td className="border border-border p-2 text-right tabular-nums w-32">
                {formatNumberDecimal(base.toString())}
              </td>
            </tr>
            {customIncome.map((ci) => (
              <tr key={ci.id}>
                <td className="border border-border p-2">
                  <span className="font-mono text-xs text-muted-foreground mr-2">
                    {ci.accountCode}
                  </span>
                  {ci.name}
                  {!ci.isTaxable && (
                    <span className="ml-2 inline-block rounded bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                      ม.42 ยกเว้นภาษี
                    </span>
                  )}
                </td>
                <td className="border border-border p-2 text-right tabular-nums">
                  {formatNumberDecimal(ci.amount)}
                </td>
              </tr>
            ))}
            <tr className="bg-muted/30">
              <td className="border border-border p-2 font-semibold">รวมรายได้</td>
              <td className="border border-border p-2 text-right tabular-nums font-semibold">
                {formatNumberDecimal(earningsTotal.toString())}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Deductions */}
      <section className="mt-5">
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          รายการหัก (Deductions)
        </p>
        <table className="w-full text-sm border border-border">
          <tbody>
            {sso.gt(0) && (
              <tr>
                <td className="border border-border p-2">เงินสมทบประกันสังคม (พนักงาน)</td>
                <td className="border border-border p-2 text-right tabular-nums w-32">
                  {formatNumberDecimal(sso.toString())}
                </td>
              </tr>
            )}
            {wht.gt(0) && (
              <tr>
                <td className="border border-border p-2">หัก ณ ที่จ่าย (ภ.ง.ด. 1)</td>
                <td className="border border-border p-2 text-right tabular-nums">
                  {formatNumberDecimal(wht.toString())}
                </td>
              </tr>
            )}
            {customDeduction.map((cd) => (
              <tr key={cd.id}>
                <td className="border border-border p-2">
                  <span className="font-mono text-xs text-muted-foreground mr-2">
                    {cd.accountCode}
                  </span>
                  {cd.name}
                </td>
                <td className="border border-border p-2 text-right tabular-nums">
                  {formatNumberDecimal(cd.amount)}
                </td>
              </tr>
            ))}
            {sso.eq(0) && wht.eq(0) && customDeduction.length === 0 && (
              <tr>
                <td colSpan={2} className="border border-border p-3 text-center text-muted-foreground italic">
                  ไม่มี
                </td>
              </tr>
            )}
            <tr className="bg-muted/30">
              <td className="border border-border p-2 font-semibold">รวมรายการหัก</td>
              <td className="border border-border p-2 text-right tabular-nums font-semibold">
                {formatNumberDecimal(deductionsTotal.toString())}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Net */}
      <section className="grid grid-cols-2 gap-6 mt-5">
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <p className="text-xs text-muted-foreground mb-1">จำนวนเงินสุทธิ (ตัวอักษร)</p>
          <p className="font-semibold leading-relaxed">{amountInText}</p>
        </div>
        <table className="text-sm">
          <tbody>
            <TotalRow label="รายได้รวม" value={earningsTotal.toString()} />
            <TotalRow label="รายการหักรวม" value={deductionsTotal.toString()} negative />
            <TotalRow label="สุทธิที่จ่าย" value={net.toString()} bold highlight />
          </tbody>
        </table>
      </section>

      {doc.note && (
        <section className="mt-6">
          <p className="text-xs text-muted-foreground mb-1">หมายเหตุ</p>
          <p className="text-sm">{doc.note}</p>
        </section>
      )}

      {/* Signatures — 2 slots only (no full grid). Employees sign on receipt;
          preparer signs on issuance. ตราประทับ unnecessary on individual slips. */}
      <section className="grid grid-cols-2 gap-6 mt-12">
        <SignatureSlot label="ผู้รับเงิน" />
        <SignatureSlot label="ผู้จัดทำ" />
      </section>

      <footer className="mt-8 pt-3 border-t border-border text-[10px] text-muted-foreground flex justify-between">
        <span>ออกเอกสารจากระบบ BESTCHOICE — ไม่ต้องเซ็นต์ถือเป็นโมฆะ</span>
        <span>
          ใบจ่ายเงินเดือน v1.0 · {slipNo}/{totalSlips}
        </span>
      </footer>
    </article>
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
  const companyName = useCompanyDisplayName();
  const companyAddress = useCompanyAddress();
  const companyTaxId = useCompanyTaxId();
  const companyLogoUrl = useCompanyLogoUrl();
  const { voucherShowQrCode, voucherShowPartialColumns } = useUiFlags();
  const lines = doc.expenseDetail?.lines ?? [];
  // D1.2.5.3 — partial-payment summary. The pre-WHT total represents the
  // "original" invoiced amount; `net` is what is actually being disbursed
  // today; the remainder is whatever the WHT withholding left behind. For
  // standalone EXPENSE/CREDIT_NOTE/VENDOR_SETTLEMENT docs the latter is
  // simply the WHT figure (no installment scheduling here). Component is
  // gated behind `voucherShowPartialColumns` flag.
  const partialOriginal = parseFloat(doc.totalAmount || '0');
  const partialPaid = parseFloat(net || '0');
  const partialRemaining = Math.max(0, partialOriginal - partialPaid);
  // D1.2.2.7 — verification QR linking to /verify/<doc.number>. Default
  // on; OWNER can disable via SystemConfig `voucher_show_qr_code = false`.
  const verifyUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/verify/${doc.number}`
    : `/verify/${doc.number}`;
  return (
    <article
      className="voucher-sheet bg-white border border-border rounded-md p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
      style={{ minHeight: '270mm' }}
    >
      {/* Company header */}
      <header className="text-center border-b-2 border-foreground pb-3">
        {companyLogoUrl && (
          <img
            src={companyLogoUrl}
            alt={companyName}
            className="mx-auto mb-2 h-12 w-auto object-contain"
          />
        )}
        <h1 className="text-xl font-bold">{companyName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {companyAddress}{companyTaxId && ` · เลขผู้เสียภาษี ${companyTaxId}`}
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

      {/* D1.2.5.3 — partial-payment breakdown. Full 3-column view when
          `voucherShowPartialColumns` is true (default); single-column
          "ยอดที่ชำระ" view when OWNER disables the flag. */}
      <section className="mt-5">
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          สรุปยอด
        </p>
        {voucherShowPartialColumns ? (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <PartialCell label="ยอดเดิม" value={partialOriginal.toFixed(2)} />
            <PartialCell label="ยอดที่ชำระ" value={partialPaid.toFixed(2)} highlight />
            <PartialCell label="ยอดคงเหลือ" value={partialRemaining.toFixed(2)} />
          </div>
        ) : (
          <div className="text-sm">
            <PartialCell label="ยอดที่ชำระ" value={partialPaid.toFixed(2)} highlight />
          </div>
        )}
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

      {/* D1.2.2.7 — verification QR (OWNER toggleable via voucher_show_qr_code) */}
      {voucherShowQrCode && (
        <section className="mt-6 flex flex-col items-end gap-1">
          <QRCodeSVG value={verifyUrl} size={80} level="M" />
          <span className="text-[9px] text-muted-foreground">สแกนเพื่อตรวจสอบ</span>
        </section>
      )}

      <footer className="mt-8 pt-3 border-t border-border text-[10px] text-muted-foreground flex justify-between">
        <span>ออกเอกสารจากระบบ BESTCHOICE — ไม่ต้องเซ็นต์ถือเป็นโมฆะ</span>
        <span>ใบสำคัญจ่ายแบบฟอร์ม v1.0</span>
      </footer>
    </article>
  );
}

/**
 * W7 (Round 2) — exported for unit testing. Form 50 ทวิ is a legal cert;
 * per-row sums MUST equal the line-by-line totals exactly. Decimal.plus()
 * preserves precision where parseFloat + += would drift a satang on
 * mixed-rate docs.
 */
export interface RateBucket {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
}
export function bucketWhtByRate(
  lines: ExpenseLine[],
  subtotal: Decimal,
  wht: Decimal,
): RateBucket[] {
  const ratedLines = lines.filter(
    (l) => new Decimal(l.whtAmount ?? '0').gt(0) && l.whtPercent != null,
  );
  if (ratedLines.length === 0) {
    // Legacy / fallback: single weighted-average row from doc totals.
    const avgRate = subtotal.gt(0) ? wht.div(subtotal).times(100) : new Decimal(0);
    return [{ rate: avgRate, base: subtotal, tax: wht }];
  }
  const map = new Map<string, RateBucket>();
  for (const l of ratedLines) {
    const rate = new Decimal(l.whtPercent ?? '0');
    const key = rate.toFixed(2);
    const b = map.get(key) ?? { rate, base: new Decimal(0), tax: new Decimal(0) };
    b.base = b.base.plus(l.amountBeforeVat ?? '0');
    b.tax = b.tax.plus(l.whtAmount ?? '0');
    map.set(key, b);
  }
  // Sort descending by tax amount for a stable, readable layout.
  return [...map.values()].sort((a, b) => b.tax.cmp(a.tax));
}

function WhtCertificate({ doc }: { doc: VoucherDoc }) {
  const companyName = useCompanyDisplayName();
  const companyAddress = useCompanyAddress();
  const companyTaxId = useCompanyTaxId();
  const companyLogoUrl = useCompanyLogoUrl();
  // W7 (Round 2) — see bucketWhtByRate above for the Decimal-precision
  // rationale. Convert to display strings only at render time via toFixed.
  const wht = new Decimal(doc.withholdingTax || '0');
  const subtotal = new Decimal(doc.subtotal || '0');
  const formLabel = doc.whtFormType === 'PND53' ? 'ภ.ง.ด. 53' : 'ภ.ง.ด. 3';
  const lines = doc.expenseDetail?.lines ?? [];
  const buckets = bucketWhtByRate(lines, subtotal, wht);
  const hasMixedRates = buckets.length > 1;
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
          <p className="font-semibold">{companyName}</p>
          <p className="text-xs text-muted-foreground">{companyAddress}{companyTaxId && ` · เลขผู้เสียภาษี ${companyTaxId}`}</p>
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
          {buckets.map((b, idx) => (
            <tr key={`${b.rate.toFixed(2)}-${idx}`}>
              <td className="border border-border p-2">
                {hasMixedRates
                  ? `ค่าบริการ / ค่าจ้าง (อัตรา ${b.rate.toFixed(2)}%, ตาม ${formLabel})`
                  : `ค่าบริการ / ค่าจ้าง (ตาม ${formLabel})`}
              </td>
              <td className="border border-border p-2 text-right tabular-nums">
                {formatNumberDecimal(b.base.toFixed(2))}
              </td>
              <td className="border border-border p-2 text-right tabular-nums">
                {b.rate.toFixed(2)}
              </td>
              <td className="border border-border p-2 text-right tabular-nums">
                {formatNumberDecimal(b.tax.toFixed(2))}
              </td>
            </tr>
          ))}
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
        <p className="font-semibold leading-relaxed">{numToThaiText(wht.toFixed(2))}</p>
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

/**
 * D1.2.5.3 — small card displaying one of the partial-payment columns
 * (ยอดเดิม / ยอดที่ชำระ / ยอดคงเหลือ). When the flag is off, only one of
 * these renders (the "ยอดที่ชำระ" cell). Pre-formatted numeric string in,
 * formatted display out — keeps formatting logic consistent with the
 * rest of the voucher.
 */
function PartialCell({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        'rounded-md border border-border p-3 text-right ' +
        (highlight ? 'bg-primary/5' : 'bg-muted/20')
      }
    >
      <p className="text-xs text-muted-foreground mb-1 text-left">{label}</p>
      <p
        className={
          'tabular-nums font-semibold ' +
          (highlight ? 'text-primary text-lg' : 'text-sm')
        }
      >
        {formatNumberDecimal(value)}
      </p>
    </div>
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

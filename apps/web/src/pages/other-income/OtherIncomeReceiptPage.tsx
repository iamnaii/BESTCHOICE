import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { otherIncomeApi } from '@/lib/otherIncome';
import QueryBoundary from '@/components/QueryBoundary';
import { formatThaiDate } from '@/lib/date';
import api from '@/lib/api';

interface CompanyInfo {
  id: string;
  nameTh: string;
  companyCode: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
}

export default function OtherIncomeReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const docQuery = useQuery({
    queryKey: ['other-income', id],
    queryFn: () => otherIncomeApi.findOne(id!),
    enabled: !!id,
  });

  const companyQuery = useQuery<CompanyInfo[]>({
    queryKey: ['companies'],
    queryFn: () => api.get<CompanyInfo[]>('/companies').then((r) => r.data),
  });

  const financeCompany = companyQuery.data?.find((c) => c.companyCode === 'FINANCE');

  return (
    <QueryBoundary
      isLoading={docQuery.isLoading}
      isError={docQuery.isError}
      error={docQuery.error}
      onRetry={docQuery.refetch}
    >
      {docQuery.data && (
        <div className="space-y-4">
          <style>{`
            @media print {
              @page { size: A4; margin: 12mm; }
              .no-print { display: none !important; }
              body { background: white !important; }
              .receipt-page { box-shadow: none !important; padding: 0 !important; }
            }
          `}</style>

          {/* Screen-only toolbar */}
          <div className="no-print rounded-xl border px-6 py-4 flex items-center justify-between bg-card">
            <button
              type="button"
              onClick={() => navigate(`/other-income/${id}`)}
              className="inline-flex items-center gap-1 text-sm hover:underline"
            >
              <ArrowLeft size={14} /> กลับ
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground rounded-md"
            >
              <Printer size={16} /> พิมพ์ใบเสร็จ
            </button>
          </div>

          {/* A4 receipt body */}
          <div className="receipt-page mx-auto max-w-[210mm] bg-background text-foreground p-8 shadow-xl">
            {/* Title block (right top) */}
            <div className="text-right mb-4">
              <p className="text-xs text-muted-foreground">(ต้นฉบับ)</p>
              <h1 className="text-3xl font-bold text-primary">ใบเสร็จรับเงิน / ใบกำกับภาษี</h1>
            </div>

            {/* Two-column: seller (left) / info box (right) */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Seller block */}
              <div className="text-sm">
                <p className="font-bold text-base">
                  {financeCompany?.nameTh ?? 'บริษัท เบสท์ช้อยส์ ไฟแนนท์ จำกัด'}
                </p>
                <p className="text-xs text-muted-foreground">
                  เลขที่ผู้เสียภาษี: {financeCompany?.taxId ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  ที่อยู่: {financeCompany?.address ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  โทร: {financeCompany?.phone ?? '—'}
                </p>
              </div>

              {/* Info box */}
              <div className="bg-primary/5 border border-primary/20 p-3 rounded text-sm">
                <p>
                  เลขที่:{' '}
                  <strong>{docQuery.data.receiptNo ?? docQuery.data.docNumber}</strong>
                </p>
                <p>วันที่: {formatThaiDate(docQuery.data.issueDate)}</p>
                {docQuery.data.journalEntryId && (
                  <p className="text-xs text-muted-foreground">
                    JV: {docQuery.data.journalEntryId}
                  </p>
                )}
              </div>
            </div>

            {/* Customer block */}
            <div className="border-t border-b py-3 mb-4 text-sm">
              <p className="font-bold mb-1">ลูกค้า / คู่ค้า:</p>
              <p>
                {docQuery.data.customer?.name ?? docQuery.data.counterpartyName ?? '—'}
              </p>
              {docQuery.data.counterpartyAddress && (
                <p className="text-xs text-muted-foreground">{docQuery.data.counterpartyAddress}</p>
              )}
              {docQuery.data.counterpartyTaxId && (
                <p className="text-xs text-muted-foreground">
                  เลขผู้เสียภาษี: {docQuery.data.counterpartyTaxId}
                </p>
              )}
              {docQuery.data.counterpartyPhone && (
                <p className="text-xs text-muted-foreground">โทร: {docQuery.data.counterpartyPhone}</p>
              )}
            </div>

            {/* Items table */}
            <table className="w-full text-sm border-collapse mb-6">
              <thead>
                <tr className="bg-muted border-t border-b">
                  <th className="px-2 py-2 text-left font-semibold">รายละเอียด</th>
                  <th className="px-2 py-2 text-right font-semibold">จำนวน</th>
                  <th className="px-2 py-2 text-right font-semibold">ราคา/หน่วย</th>
                  <th className="px-2 py-2 text-center font-semibold">VAT</th>
                  <th className="px-2 py-2 text-right font-semibold">ก่อนภาษี</th>
                </tr>
              </thead>
              <tbody>
                {docQuery.data.items.map((it) => (
                  <tr key={it.id} className="border-b">
                    <td className="px-2 py-2">
                      <p className="font-semibold">{it.accountName}</p>
                      <p className="text-xs text-muted-foreground">({it.accountCode})</p>
                      {it.description && (
                        <p className="text-xs text-muted-foreground">{it.description}</p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {Number(it.quantity).toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {Number(it.unitAmount).toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-center text-xs">
                      {Number(it.vatPct) > 0 ? `${it.vatPct}%` : '-'}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {Number(it.amountBeforeVat).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary totals: left empty / right highlight */}
            <div className="grid grid-cols-2 gap-4 text-sm mb-8">
              <div>
                {/* Left breakdown — payment note */}
                <p className="text-xs text-muted-foreground mt-2">
                  ช่องทางชำระ: {docQuery.data.paymentAccountCode}
                </p>
                {docQuery.data.paymentDate && (
                  <p className="text-xs text-muted-foreground">
                    วันที่รับเงิน: {formatThaiDate(docQuery.data.paymentDate)}
                  </p>
                )}
                {docQuery.data.customerNote && (
                  <p className="text-xs text-muted-foreground mt-1">
                    หมายเหตุ: {docQuery.data.customerNote}
                  </p>
                )}
              </div>

              {/* Right highlight */}
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>รวมก่อน VAT:</span>
                  <strong className="font-mono">{Number(docQuery.data.incomeGross).toFixed(2)}</strong>
                </div>
                {Number(docQuery.data.vatAmount) > 0 && (
                  <div className="flex justify-between">
                    <span>VAT 7%:</span>
                    <strong className="font-mono">{Number(docQuery.data.vatAmount).toFixed(2)}</strong>
                  </div>
                )}
                <div className="flex justify-between bg-primary/5 border border-primary/20 p-2 rounded">
                  <span className="font-bold">จำนวนเงินทั้งสิ้น:</span>
                  <strong className="font-mono">
                    {Number(docQuery.data.totalAmount).toFixed(2)} ฿
                  </strong>
                </div>
                {Number(docQuery.data.whtAmount) > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>หัก ณ ที่จ่าย ({docQuery.data.items[0]?.whtPct}%):</span>
                    <span className="font-mono">
                      ({Number(docQuery.data.whtAmount).toFixed(2)})
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1 text-xs text-muted-foreground">
                  <span>ยอดที่ชำระสุทธิ:</span>
                  <span className="font-mono font-bold">
                    {Number(docQuery.data.amountReceived).toFixed(2)} ฿
                  </span>
                </div>
              </div>
            </div>

            {/* B11: 4 signature blocks per spec §3.5 + QR code */}
            <div className="mt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 print:grid-cols-4 gap-6 text-center text-xs text-muted-foreground">
                {/* 1: ผู้ออกเอกสาร */}
                <div>
                  <div className="border-b border-border mb-2 h-14"></div>
                  <p className="font-medium">ผู้ออกเอกสาร</p>
                  <p className="text-muted-foreground">ลายเซ็น / วันที่</p>
                </div>
                {/* 2: ตราประทับผู้ขาย */}
                <div>
                  <div className="border border-dashed border-border mb-2 h-14 flex items-center justify-center rounded">
                    <span className="text-muted-foreground/50">ตราประทับ</span>
                  </div>
                  <p className="font-medium">ตราประทับ (ผู้ขาย)</p>
                </div>
                {/* 3: ผู้รับเอกสาร */}
                <div>
                  <div className="border-b border-border mb-2 h-14"></div>
                  <p className="font-medium">ผู้รับเอกสาร</p>
                  <p className="text-muted-foreground">ลายเซ็น / วันที่</p>
                </div>
                {/* 4: ตราประทับลูกค้า */}
                <div>
                  <div className="border border-dashed border-border mb-2 h-14 flex items-center justify-center rounded">
                    <span className="text-muted-foreground/50">ตราประทับ</span>
                  </div>
                  <p className="font-medium">ตราประทับ (ลูกค้า)</p>
                </div>
              </div>
              {/* QR code below signature row */}
              <div className="flex flex-col items-center gap-1 mt-4">
                <QRCodeSVG
                  value={`${window.location.origin}/other-income/${docQuery.data.id}`}
                  size={72}
                  level="M"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {docQuery.data.docNumber}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

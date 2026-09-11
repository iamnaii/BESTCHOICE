import { printDocument } from '@/lib/print-document';
// Purchasing v2 B1 — Printable ใบรับของ (Goods Receipt) per GoodsReceiving record.
//
// Route: /purchase-orders/:id/goods-receivings/:receivingId/print
//
// Mirrors PaymentVoucherPage's print pattern: screen-only toolbar (.no-print),
// an A4 voucher-sheet, co-located @media print CSS, window.print() for PDF.
// Receiving posts NO journal entry — this is an operational receipt, not an
// accounting document (spec red line: purchasing stays JE-free).

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateTime } from '@/utils/formatters';
import {
  useCompanyDisplayName,
  useCompanyAddress,
  useCompanyTaxId,
  useCompanyLogoUrl,
} from '@/hooks/useCompanyInfo';

interface GRItem {
  id: string;
  status: 'PASS' | 'REJECT';
  imeiSerial: string | null;
  serialNumber: string | null;
  rejectReason: string | null;
  defectReason: string | null;
  poItem: {
    brand: string;
    model: string;
    color: string | null;
    storage: string | null;
    category: string | null;
    accessoryType: string | null;
    accessoryBrand: string | null;
  } | null;
}

interface GRDoc {
  id: string;
  grNumber: string;
  createdAt: string;
  notes: string | null;
  po: { id: string; poNumber: string; supplier: { id: string; name: string } };
  receivedBy: { id: string; name: string };
  items: GRItem[];
}

const DEFECT_LABELS: Record<string, string> = {
  SCREEN: 'จอภาพ',
  BATTERY: 'แบตเตอรี่',
  IMEI_BLOCKED: 'IMEI ถูกบล็อก',
  BOX_MISSING: 'กล่อง/อุปกรณ์ไม่ครบ',
  WRONG_MODEL: 'ผิดรุ่น',
  DOA: 'เสียตั้งแต่แกะ (DOA)',
  COSMETIC: 'ตำหนิภายนอก',
  OTHER: 'อื่นๆ',
};

function itemDesc(it: GRItem): string {
  const p = it.poItem;
  if (!p) return '-';
  if (p.category === 'ACCESSORY') {
    const isCharger = p.accessoryType === 'ชุดชาร์จ';
    const parts = [p.accessoryType, p.accessoryBrand, p.model ? (isCharger ? p.model : `สำหรับ ${p.model}`) : '']
      .filter(Boolean);
    return parts.join(' / ') || '-';
  }
  return [p.brand, p.model, p.color, p.storage].filter(Boolean).join(' ') || '-';
}

export default function GoodsReceiptPrintPage() {
  const { id, receivingId } = useParams<{ id: string; receivingId: string }>();
  const navigate = useNavigate();

  const grQuery = useQuery<GRDoc>({
    queryKey: ['gr-print', id, receivingId],
    queryFn: async () => {
      const { data } = await api.get(`/purchase-orders/${id}/goods-receivings/${receivingId}`);
      return data;
    },
    enabled: !!id && !!receivingId,
  });

  useEffect(() => {
    document.title = grQuery.data ? `ใบรับของ ${grQuery.data.grNumber}` : 'ใบรับของ';
  }, [grQuery.data]);

  return (
    <div className="bg-muted/30 min-h-screen print:bg-white print:min-h-0">
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
            onClick={printDocument}
            disabled={!grQuery.data || grQuery.isFetching || grQuery.isError}
            className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Printer size={14} />
            พิมพ์ / Save PDF
          </button>
        </div>
      </div>

      <QueryBoundary
        isLoading={grQuery.isLoading}
        isError={grQuery.isError}
        error={grQuery.error}
        onRetry={grQuery.refetch}
      >
        {grQuery.data && <GoodsReceiptSheet doc={grQuery.data} />}
      </QueryBoundary>

      <style>{`
        @page { size: A4; margin: 20mm 19mm; }
        @media print {
          .no-print { display: none !important; }
          .voucher-sheet { box-shadow: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}

function GoodsReceiptSheet({ doc }: { doc: GRDoc }) {
  const companyName = useCompanyDisplayName();
  const companyAddress = useCompanyAddress();
  const companyTaxId = useCompanyTaxId();
  const companyLogoUrl = useCompanyLogoUrl();
  const passCount = doc.items.filter((i) => i.status === 'PASS').length;
  const rejectCount = doc.items.filter((i) => i.status === 'REJECT').length;

  return (
    <div className="max-w-[210mm] mx-auto py-6 px-6 print:px-0 print:py-0">
      <article
        className="voucher-sheet bc-document bg-white border border-border rounded-md p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
      >
        <header className="bc-doc-header">
          <div className="bc-doc-brand">
            {companyLogoUrl && (
              <img src={companyLogoUrl} alt={companyName} className="mb-2 h-12 w-auto object-contain" />
            )}
            <p className="bc-doc-company">{companyName}</p>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">
              {companyAddress}
            </p>
            {companyTaxId && <p>เลขผู้เสียภาษี {companyTaxId}</p>}
          </div>
          <div className="bc-doc-identity">
            <h1>ใบรับของ</h1>
            <p className="bc-doc-kicker">GOODS RECEIPT</p>
            <div className="bc-doc-meta">
              <span>เลขที่เอกสาร</span><span>{doc.grNumber}</span>
              <span>วันที่รับ</span><span>{formatDateTime(doc.createdAt)}</span>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-8 gap-y-2 mt-5 text-sm">
          <Meta label="อ้างอิงใบสั่งซื้อ" value={doc.po.poNumber} mono />
          <Meta label="ผู้จัดจำหน่าย" value={doc.po.supplier.name} />
          <Meta label="ผู้รับของ" value={doc.receivedBy.name} />
        </section>

        <table className="w-full table-fixed mt-6 text-xs border border-border">
          <colgroup>
            <col style={{ width: '6%' }} /><col style={{ width: '25%' }} />
            <col style={{ width: '25%' }} /><col style={{ width: '12%' }} /><col style={{ width: '32%' }} />
          </colgroup>
          <thead className="bg-muted/40">
            <tr>
              <th className="border border-border p-2 text-left w-10">#</th>
              <th className="border border-border p-2 text-left">รายการ</th>
              <th className="border border-border p-2 text-left">IMEI / Serial</th>
              <th className="border border-border p-2 text-center w-20">ผล</th>
              <th className="border border-border p-2 text-left">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-border p-3 text-center text-muted-foreground">
                  ไม่มีรายการ
                </td>
              </tr>
            ) : (
              doc.items.map((it, idx) => (
                <tr key={it.id}>
                  <td className="border border-border p-2 tabular-nums">{idx + 1}</td>
                  <td className="border border-border p-2 leading-snug">{itemDesc(it)}</td>
                  <td className="border border-border p-2 font-mono">
                    {it.imeiSerial || it.serialNumber || '—'}
                  </td>
                  <td className="border border-border p-2 text-center">
                    {it.status === 'PASS' ? 'ผ่าน' : 'ไม่ผ่าน'}
                  </td>
                  <td className="border border-border p-2 leading-snug">
                    {it.status === 'REJECT'
                      ? [it.defectReason ? DEFECT_LABELS[it.defectReason] ?? it.defectReason : null, it.rejectReason]
                          .filter(Boolean)
                          .join(' · ') || '—'
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {doc.notes && (
          <section className="mt-6">
            <p className="text-xs text-muted-foreground mb-1">หมายเหตุ</p>
            <p className="text-sm leading-snug">{doc.notes}</p>
          </section>
        )}

        <div className="bc-doc-closing">
          <div className="bc-doc-grand">
            <span>ตรวจรับทั้งหมด {doc.items.length} รายการ</span>
            <span>ผ่าน {passCount} · ไม่ผ่าน {rejectCount}</span>
          </div>
          <section className="bc-doc-approval">
            <Sig label="ผู้รับของ" />
            <Sig label="ผู้ตรวจสอบ" />
          </section>

          <footer className="bc-doc-footer">
            <span>ออกเอกสารจากระบบ BESTCHOICE — เอกสารรับของภายใน ไม่ใช่ใบกำกับภาษี</span>
            <span>ใบรับของ v1.0</span>
          </footer>
        </div>
      </article>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground leading-snug">{label}</p>
      <p className={(mono ? 'font-mono ' : '') + 'text-sm leading-snug'}>{value}</p>
    </div>
  );
}

function Sig({ label }: { label: string }) {
  return (
    <div className="bc-doc-signature">
      <div className="sign-space" />
      <p className="text-xs text-muted-foreground leading-snug">({label})</p>
      <p className="text-[10px] text-muted-foreground mt-1">วันที่ ___ / ___ / ______</p>
    </div>
  );
}

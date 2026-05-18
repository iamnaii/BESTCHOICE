import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CompanyFilter from '@/components/CompanyFilter';
import { THAI_MONTHS_FULL } from '@/lib/date';
import { FileText, Download, AlertCircle } from 'lucide-react';

interface ETaxInvoice {
  paymentId: string;
  paidDate: string | Date | null;
  installmentNo: number;
  contractId: string;
  contractNumber: string;
  customerName: string;
  customerTaxId: string | null;
  amountBeforeVat: number | string;
  vatAmount: number | string;
  total: number | string;
}
interface ETaxListResponse {
  data: ETaxInvoice[];
  total: number;
  page: number;
  limit: number;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden bg-background text-foreground';

function fmtNumber(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return '0.00';
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ETaxInvoicePage() {
  const now = new Date();
  const [companyId, setCompanyId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const enabled = Boolean(companyId);

  const { data, isLoading, isError, error, refetch } = useQuery<ETaxListResponse>({
    queryKey: ['e-tax', 'invoices', companyId, year, month, page],
    enabled,
    queryFn: async () => {
      const url = `/e-tax/invoices?companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}&page=${page}&limit=${LIMIT}`;
      const res = await api.get(url);
      return res.data;
    },
  });

  async function handleDownloadPdf(paymentId: string) {
    try {
      const res = await api.get(`/e-tax/invoices/${paymentId}/pdf`, {
        responseType: 'blob',
      });
      const blob = res.data as Blob;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      // Critical #6+#7: file is an internal receipt, NOT a legal tax invoice
      a.download = `receipt-${paymentId}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message ?? 'ดาวน์โหลด PDF ล้มเหลว');
    }
  }

  async function handleExportCsv() {
    if (!companyId) {
      toast.error('กรุณาเลือกบริษัทก่อน');
      return;
    }
    try {
      const res = await api.get(
        `/e-tax/export-csv?companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}`,
        { responseType: 'blob' },
      );
      const blob = res.data as Blob;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `e-tax-${year}-${String(month).padStart(2, '0')}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message ?? 'ดาวน์โหลด CSV ล้มเหลว');
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <PageHeader
        title="e-Tax Invoice (Phase 1: Receipt + CSV)"
        subtitle="ใบรับเงินภายใน + ส่งออก CSV รายเดือน — Phase 2 จะเป็นใบกำกับภาษีอิเล็กทรอนิกส์จริงตาม ม.86/4"
        icon={<FileText className="size-5" aria-hidden />}
        action={
          <Button variant="outline" onClick={handleExportCsv} disabled={!companyId}>
            <Download className="size-4 mr-2" aria-hidden />
            Export CSV (รายเดือน)
          </Button>
        }
      />

      {/* Critical #6+#7: explicit Phase 1 limitations banner */}
      <div
        data-testid="phase2-banner"
        className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 mb-4"
      >
        <AlertCircle className="size-4 text-destructive mt-0.5 shrink-0" aria-hidden />
        <div className="text-sm text-foreground leading-snug">
          <p className="font-medium mb-1">
            ระยะที่ 1 — ใบรับเงินภายใน (Internal Receipt) เท่านั้น
          </p>
          <p className="text-muted-foreground">
            PDF ที่ดาวน์โหลด <strong>ไม่ใช่ใบกำกับภาษีอิเล็กทรอนิกส์ตามกฎหมาย</strong>
            (ม.86/4 ป.รัษฎากร + ประกาศอธิบดี ฉ.48). ใช้เพื่อยืนยันภายในระบบเท่านั้น —
            ห้ามใช้ส่ง RD หรือมอบให้ลูกค้าเป็นใบกำกับภาษี.
          </p>
          <p className="text-muted-foreground mt-1">
            ระยะที่ 2: ใบกำกับภาษีอิเล็กทรอนิกส์จริง (Thai font, full ม.86/4 fields,
            PKCS#7 ลายเซ็นดิจิทัล, ส่ง XML ให้ RD)
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground leading-snug mb-1 block">บริษัท</label>
              <CompanyFilter value={companyId} onChange={setCompanyId} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground leading-snug mb-1 block">ปี (ค.ศ.)</label>
              <input
                type="number"
                value={year}
                onChange={(e) => {
                  setYear(parseInt(e.target.value) || now.getFullYear());
                  setPage(1);
                }}
                className={inputClass}
                min={2020}
                max={2100}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground leading-snug mb-1 block">เดือน</label>
              <select
                value={month}
                onChange={(e) => {
                  setMonth(parseInt(e.target.value));
                  setPage(1);
                }}
                className={inputClass}
              >
                {THAI_MONTHS_FULL.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!companyId && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground leading-snug">
            กรุณาเลือกบริษัทเพื่อแสดงรายการ
          </CardContent>
        </Card>
      )}

      {enabled && (
        <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
          {data && (
            <Card data-testid="invoice-list">
              <CardHeader>
                <h3 className="text-sm font-semibold text-foreground leading-snug">
                  รายการชำระเงินมีภาษีมูลค่าเพิ่ม ({data.total} รายการ)
                </h3>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 pr-2">วันที่</th>
                        <th className="py-2 pr-2">สัญญา / งวด</th>
                        <th className="py-2 pr-2">ลูกค้า</th>
                        <th className="py-2 pr-2">เลขประจำตัวผู้เสียภาษี</th>
                        <th className="py-2 pr-2 text-right">ก่อน VAT (฿)</th>
                        <th className="py-2 pr-2 text-right">VAT (฿)</th>
                        <th className="py-2 pr-2 text-right">รวม (฿)</th>
                        <th className="py-2 pr-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-4 text-center text-muted-foreground">
                            ไม่มีรายการในงวด
                          </td>
                        </tr>
                      )}
                      {data.data.map((inv) => (
                        <tr key={inv.paymentId} className="border-b border-border/40">
                          <td className="py-2 pr-2 tabular-nums">
                            {inv.paidDate
                              ? new Date(inv.paidDate).toLocaleDateString('th-TH')
                              : '-'}
                          </td>
                          <td className="py-2 pr-2 font-mono text-xs">
                            {inv.contractNumber} / {inv.installmentNo}
                          </td>
                          <td className="py-2 pr-2">{inv.customerName}</td>
                          <td className="py-2 pr-2 font-mono text-xs">
                            {inv.customerTaxId ?? '-'}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {fmtNumber(inv.amountBeforeVat)}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {fmtNumber(inv.vatAmount)}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {fmtNumber(inv.total)}
                          </td>
                          <td className="py-2 pr-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDownloadPdf(inv.paymentId)}
                              aria-label={`ดาวน์โหลด PDF สัญญา ${inv.contractNumber} งวด ${inv.installmentNo}`}
                            >
                              <Download className="size-3.5 mr-1.5" aria-hidden />
                              PDF
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {data.total > LIMIT && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-xs text-muted-foreground leading-snug">
                      หน้า {data.page} จาก {Math.ceil(data.total / LIMIT)}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                      >
                        ก่อนหน้า
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={page >= Math.ceil(data.total / LIMIT)}
                      >
                        ถัดไป
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </QueryBoundary>
      )}
    </div>
  );
}

export default ETaxInvoicePage;

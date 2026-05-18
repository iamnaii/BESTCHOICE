import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CompanyFilter from '@/components/CompanyFilter';
import { THAI_MONTHS_FULL } from '@/lib/date';
import { Calculator, Download, FileText, AlertCircle } from 'lucide-react';

interface PP30LineItemSale {
  date: string | Date | null;
  description: string;
  contractNumber: string;
  customerName: string;
  amount: number | string;
  vatAmount: number | string | null;
}
interface PP30LineItemPurchase {
  date: string | Date | null;
  description: string;
  vendorName: string | null;
  vendorTaxId: string | null;
  taxInvoiceNo: string | null;
  amount: number | string;
  vatAmount: number | string;
}
interface PP30Preview {
  totalSales: number | string;
  totalVatOutput: number | string;
  totalPurchases: number | string;
  totalVatInput: number | string;
  netVat: number | string;
  lineItems: { sales: PP30LineItemSale[]; purchases: PP30LineItemPurchase[] };
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden bg-background text-foreground';

function fmtNumber(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return '0.00';
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function daysToDeadline(year: number, month: number): number {
  // ภ.พ.30 deadline = 15th of next month
  const deadline = new Date(year, month, 15); // month index → next month (zero-indexed)
  const today = new Date();
  const diffMs = deadline.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function VatReportPage() {
  const now = new Date();
  const [companyId, setCompanyId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const enabled = Boolean(companyId);

  const { data, isLoading, isError, error, refetch } = useQuery<PP30Preview>({
    queryKey: ['tax', 'pp30-preview', companyId, year, month],
    enabled,
    queryFn: async () => {
      const res = await api.get(
        `/tax/pp30-preview?companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}`,
      );
      return res.data;
    },
  });

  const deadlineDays = useMemo(() => daysToDeadline(year, month), [year, month]);

  async function handleExport() {
    if (!companyId) {
      toast.error('กรุณาเลือกบริษัทก่อน');
      return;
    }
    try {
      const res = await api.get(
        `/tax/export-xlsx?form=PP30&companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}`,
        { responseType: 'blob' },
      );
      const blob = res.data as Blob;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `PP30-${year}-${String(month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message ?? 'ดาวน์โหลด XLSX ล้มเหลว');
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <PageHeader
        title="ภ.พ.30 — ภาษีมูลค่าเพิ่ม"
        subtitle="ยื่นแบบ ภ.พ.30 ทุกวันที่ 15 ของเดือนถัดไป (ม.82/3, ม.83 ประมวลรัษฎากร)"
        icon={<Calculator className="size-5" aria-hidden />}
        action={
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!companyId || isLoading}
            aria-label="ดาวน์โหลด XLSX"
          >
            <Download className="size-4 mr-2" aria-hidden />
            Export XLSX
          </Button>
        }
      />

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
                onChange={(e) => setYear(parseInt(e.target.value) || now.getFullYear())}
                className={inputClass}
                min={2020}
                max={2100}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground leading-snug mb-1 block">เดือน</label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
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
            กรุณาเลือกบริษัทเพื่อแสดงรายงาน
          </CardContent>
        </Card>
      )}

      {enabled && (
        <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
          {data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Card data-testid="card-output-vat">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground leading-snug">ภาษีขาย (Cr 21-2101)</p>
                    <p className="text-lg font-semibold tabular-nums mt-1">
                      {fmtNumber(data.totalVatOutput)} ฿
                    </p>
                  </CardContent>
                </Card>
                <Card data-testid="card-input-vat">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground leading-snug">ภาษีซื้อ (Dr 11-4101)</p>
                    <p className="text-lg font-semibold tabular-nums mt-1">
                      {fmtNumber(data.totalVatInput)} ฿
                    </p>
                  </CardContent>
                </Card>
                <Card data-testid="card-net-vat">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground leading-snug">ภาษีที่ต้องชำระ</p>
                    <p className="text-lg font-semibold tabular-nums mt-1 text-primary">
                      {fmtNumber(data.netVat)} ฿
                    </p>
                  </CardContent>
                </Card>
                <Card data-testid="card-deadline">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground leading-snug">กำหนดยื่น</p>
                    <p className="text-lg font-semibold tabular-nums mt-1">
                      {deadlineDays > 0 ? `อีก ${deadlineDays} วัน` : deadlineDays === 0 ? 'วันนี้' : `เลย ${Math.abs(deadlineDays)} วัน`}
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      วันที่ 15 / {THAI_MONTHS_FULL[month % 12]}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className="mb-4" data-testid="section-sales">
                <CardHeader>
                  <h3 className="text-sm font-semibold text-foreground leading-snug">
                    ยอดขาย — แยกตามอัตราภาษี
                  </h3>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b border-border">
                          <th className="py-2 pr-2">วันที่</th>
                          <th className="py-2 pr-2">สัญญา</th>
                          <th className="py-2 pr-2">ลูกค้า</th>
                          <th className="py-2 pr-2 text-right">มูลค่า (฿)</th>
                          <th className="py-2 pr-2 text-right">VAT 7% (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.lineItems.sales.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-4 text-center text-muted-foreground">
                              ไม่มีรายการขาย
                            </td>
                          </tr>
                        )}
                        {data.lineItems.sales.map((s, idx) => (
                          <tr key={idx} className="border-b border-border/40">
                            <td className="py-2 pr-2 tabular-nums">
                              {s.date ? new Date(s.date).toLocaleDateString('th-TH') : '-'}
                            </td>
                            <td className="py-2 pr-2 font-mono text-xs">{s.contractNumber}</td>
                            <td className="py-2 pr-2">{s.customerName}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(s.amount)}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(s.vatAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card className="mb-4" data-testid="section-purchases">
                <CardHeader>
                  <h3 className="text-sm font-semibold text-foreground leading-snug">
                    ยอดซื้อ — รายผู้ขาย (Dr 11-4101 เคลม ภ.พ.30 ได้)
                  </h3>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b border-border">
                          <th className="py-2 pr-2">วันที่</th>
                          <th className="py-2 pr-2">ผู้ขาย</th>
                          <th className="py-2 pr-2">เลขผู้เสียภาษี</th>
                          <th className="py-2 pr-2">เลขที่กำกับภาษี</th>
                          <th className="py-2 pr-2 text-right">มูลค่า (฿)</th>
                          <th className="py-2 pr-2 text-right">VAT (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.lineItems.purchases.length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-4 text-center text-muted-foreground">
                              ไม่มีรายการซื้อ
                            </td>
                          </tr>
                        )}
                        {data.lineItems.purchases.map((p, idx) => (
                          <tr key={idx} className="border-b border-border/40">
                            <td className="py-2 pr-2 tabular-nums">
                              {p.date ? new Date(p.date).toLocaleDateString('th-TH') : '-'}
                            </td>
                            <td className="py-2 pr-2">{p.vendorName ?? '-'}</td>
                            <td className="py-2 pr-2 font-mono text-xs">{p.vendorTaxId ?? '-'}</td>
                            <td className="py-2 pr-2 font-mono text-xs">{p.taxInvoiceNo ?? '-'}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(p.amount)}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(p.vatAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="section-vat60day">
                <CardHeader>
                  <h3 className="text-sm font-semibold text-foreground leading-snug flex items-center gap-2">
                    <AlertCircle className="size-4 text-warning" aria-hidden />
                    VAT บังคับ-ลูกหนี้ค้าง 60 วัน (Cr 21-2103)
                  </h3>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-snug">
                    ระบบจะตั้งภาษีบังคับอัตโนมัติทุกคืน 02:00 BKK สำหรับงวดที่ค้างเกิน 60 วันที่ยังไม่ชำระ
                    — รวบรวมในรายงานเดือนถัดไป (ดู journal entries หมวด Vat60dayMandatoryTemplate).
                  </p>
                </CardContent>
              </Card>

              <div className="mt-4 flex items-center justify-end">
                <Button variant="outline" disabled aria-label="สร้างรายงาน (เร็วๆ นี้)">
                  <FileText className="size-4 mr-2" aria-hidden />
                  สร้างรายงาน (Snapshot)
                </Button>
              </div>
            </>
          )}
        </QueryBoundary>
      )}
    </div>
  );
}

export default VatReportPage;

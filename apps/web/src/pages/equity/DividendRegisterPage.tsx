import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Coins, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import api, { getErrorMessage } from '@/lib/api';
import { equityApi } from '@/lib/equity';
import type { DividendRegisterRow } from '@/lib/equity.types';
import { formatNumberDecimal } from '@/utils/formatters';

// ผู้จ่ายเงินบนหนังสือรับรอง = นิติบุคคลจดทะเบียน (FINANCE CompanyInfo) —
// รูปแบบเดียวกับ WhtAnnualPage.tsx (ผู้จ่ายเงินได้ ภ.ง.ด.1ก/50 ทวิ)
interface CompanyRow {
  id: string;
  nameTh: string;
  taxId: string;
  address: string;
  directorName: string;
  companyCode: string | null;
}

export default function DividendRegisterPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [certFor, setCertFor] = useState<DividendRegisterRow | null>(null);
  const [xlsxMonth, setXlsxMonth] = useState(new Date().getMonth() + 1);

  const q = useQuery({
    queryKey: ['dividend-register', year],
    queryFn: () => equityApi.dividendRegister(year),
  });

  // ผู้จ่ายเงินบนหนังสือรับรอง ม.50 ทวิ = นิติบุคคลจดทะเบียน (FINANCE CompanyInfo)
  const companies = useQuery({
    queryKey: ['company-info-list'],
    queryFn: () => api.get<CompanyRow[]>('/company').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const payer = companies.data?.find((c) => c.companyCode === 'FINANCE') ?? companies.data?.[0];

  const downloadXlsx = async (month: number) => {
    try {
      const res = await api.get(`/tax/export-xlsx?form=PND2&year=${year}&month=${month}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PND2-${year}-${String(month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="ทะเบียนปันผล + ภ.ง.ด.2"
        subtitle="สรุปเงินปันผลจ่ายจริงต่อผู้ถือหุ้น — ภ.ง.ด.2 ยื่นภายในวันที่ 7 ของเดือนถัดจากเดือนที่จ่าย (ม.52)"
        icon={<Coins size={20} />}
        action={
          <Button variant="ghost" asChild>
            <Link to="/finance/equity">
              <ArrowLeft className="h-4 w-4 mr-1" /> กลับ
            </Link>
          </Button>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="border border-border rounded-md px-3 py-2 text-sm bg-background"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
        >
          {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
            <option key={y} value={y}>
              ปี {y + 543}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="border border-border rounded-md px-3 py-2 text-sm bg-background"
            value={xlsxMonth}
            onChange={(e) => setXlsxMonth(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                เดือน {m}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => downloadXlsx(xlsxMonth)}>
            <Download className="h-4 w-4 mr-1" /> ภ.ง.ด.2 XLSX
          </Button>
        </div>
      </div>

      <QueryBoundary
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={q.refetch}
      >
        <Card>
          <CardContent className="pt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2">ผู้ถือหุ้น</th>
                  <th>เลขผู้เสียภาษี</th>
                  <th className="text-center">ครั้ง</th>
                  <th className="text-right">ปันผลก่อนหัก</th>
                  <th className="text-right">WHT 10%</th>
                  <th className="text-right">จ่ายสุทธิ</th>
                  <th>เอกสารอ้างอิง</th>
                  <th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {(q.data?.rows ?? []).map((r) => (
                  <tr key={r.shareholderId} className="border-b border-border">
                    <td className="py-2 font-medium leading-snug">{r.name}</td>
                    <td className="font-mono text-xs">{r.taxId ?? '—'}</td>
                    <td className="text-center">{r.payCount}</td>
                    <td className="text-right font-mono">
                      {formatNumberDecimal(parseFloat(r.gross), 2)}
                    </td>
                    <td className="text-right font-mono">
                      {formatNumberDecimal(parseFloat(r.wht), 2)}
                    </td>
                    <td className="text-right font-mono text-success">
                      {formatNumberDecimal(parseFloat(r.net), 2)}
                    </td>
                    <td className="font-mono text-[11px] text-muted-foreground leading-snug">
                      {r.docNumbers.join(', ')}
                    </td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setCertFor(r)}>
                        <Printer className="h-4 w-4 mr-1" /> หนังสือรับรอง
                      </Button>
                    </td>
                  </tr>
                ))}
                {(q.data?.rows ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-10 text-center text-muted-foreground leading-snug"
                    >
                      ยังไม่มีการจ่ายปันผลปีนี้
                    </td>
                  </tr>
                )}
              </tbody>
              {q.data && q.data.rows.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2" colSpan={3}>
                      รวม
                    </td>
                    <td className="text-right font-mono">
                      {formatNumberDecimal(parseFloat(q.data.totals.gross), 2)}
                    </td>
                    <td className="text-right font-mono">
                      {formatNumberDecimal(parseFloat(q.data.totals.wht), 2)}
                    </td>
                    <td className="text-right font-mono">
                      {formatNumberDecimal(parseFloat(q.data.totals.net), 2)}
                    </td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      </QueryBoundary>

      {/* หนังสือรับรองการหักภาษี ณ ที่จ่าย (ม.50 ทวิ) — pattern จาก WhtAnnualPage.tsx บรรทัด 212-321 */}
      <Dialog open={certFor !== null} onOpenChange={(o) => !o && setCertFor(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {certFor && payer && (
            <>
              <style>{`@media print {
                body * { visibility: hidden !important; }
                #div-cert-print, #div-cert-print * { visibility: visible !important; }
                #div-cert-print { position: fixed; inset: 0; padding: 24px; background: white; }
              }`}</style>
              {/* print/receipt context — เอกสารทางการพิมพ์ขาวดำ ใช้สีตรงได้ตามข้อยกเว้นใน rules */}
              <div id="div-cert-print" className="bg-white text-black p-6 text-sm space-y-4">
                <h2 className="text-center font-bold text-base leading-snug">
                  หนังสือรับรองการหักภาษี ณ ที่จ่าย (ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร)
                </h2>
                <div className="border border-black p-3 space-y-1">
                  <div className="font-semibold leading-snug">ผู้จ่ายเงิน</div>
                  <div className="leading-snug">{payer.nameTh}</div>
                  <div className="leading-snug">เลขประจำตัวผู้เสียภาษี: {payer.taxId}</div>
                  <div className="leading-snug">{payer.address}</div>
                </div>
                <div className="border border-black p-3 space-y-1">
                  <div className="font-semibold leading-snug">ผู้รับเงิน (ผู้ถูกหักภาษี)</div>
                  <div className="leading-snug">{certFor.name}</div>
                  <div className="leading-snug">เลขประจำตัวผู้เสียภาษี: {certFor.taxId ?? '—'}</div>
                </div>
                <table className="w-full border-collapse border border-black text-sm">
                  <thead>
                    <tr>
                      <th className="border border-black p-2 text-left">ประเภทเงินได้</th>
                      <th className="border border-black p-2 text-right">จำนวนเงินที่จ่าย</th>
                      <th className="border border-black p-2 text-right">ภาษีที่หักนำส่ง</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black p-2 leading-snug">
                        เงินปันผล — ม.40(4)(ข) (ภ.ง.ด.2) · ปีภาษี {year + 543}
                      </td>
                      <td className="border border-black p-2 text-right font-mono">
                        {formatNumberDecimal(parseFloat(certFor.gross), 2)}
                      </td>
                      <td className="border border-black p-2 text-right font-mono">
                        {formatNumberDecimal(parseFloat(certFor.wht), 2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="flex justify-between pt-8">
                  <div>วันที่ออกหนังสือรับรอง: ____/____/______</div>
                  <div className="text-center">
                    <div>ลงชื่อ ______________________ ผู้จ่ายเงิน</div>
                    <div className="text-xs mt-1">({payer.directorName})</div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setCertFor(null)}>
                  ปิด
                </Button>
                <Button onClick={() => window.print()}>
                  <Printer className="h-4 w-4 mr-1" /> พิมพ์
                </Button>
              </div>
            </>
          )}
          {certFor && !payer && (
            <div className="text-sm text-muted-foreground py-6 text-center leading-snug">
              กำลังโหลดข้อมูลบริษัท… (ต้องมี CompanyInfo ฝั่ง FINANCE)
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

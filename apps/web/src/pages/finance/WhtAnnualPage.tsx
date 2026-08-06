import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { formatNumberDecimal } from '@/utils/formatters';
import { FileBadge, Download, Printer } from 'lucide-react';

/**
 * ภ.ง.ด.1ก (สรุปรายปี) + ใบรับรองหักภาษี ณ ที่จ่าย ม.50 ทวิ สำหรับพนักงาน
 * (payroll round 2, 2026-08-06). นิติบุคคลเดียว — รวมทุกสาขา/ทุกฝั่ง.
 * ตัวเลข "ค่าจ้างรวมทั้งปี" ท้ายตารางใช้อ้างอิงยื่น กท.20ก (กองทุนเงินทดแทน).
 */

interface AnnualItem {
  employeeName: string;
  employeeTaxId: string | null;
  monthsPaid: number;
  grossTotal: string;
  whtTotal: string;
  ssoTotal: string;
}

interface AnnualPreview {
  year: number;
  items: AnnualItem[];
  count: number;
  grossTotal: string;
  whtTotal: string;
  annualWageTotal: string;
}

interface CompanyRow {
  id: string;
  nameTh: string;
  taxId: string;
  address: string;
  directorName: string;
  companyCode: string | null;
}

export default function WhtAnnualPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [certFor, setCertFor] = useState<AnnualItem | null>(null);

  const query = useQuery({
    queryKey: ['pnd1-annual', year],
    queryFn: () =>
      api.get<AnnualPreview>(`/tax/pnd1-annual-preview?year=${year}`).then((r) => r.data),
  });

  // ผู้จ่ายเงินได้บนใบ 50 ทวิ = นิติบุคคลจดทะเบียน (FINANCE CompanyInfo)
  const companies = useQuery({
    queryKey: ['company-info-list'],
    queryFn: () => api.get<CompanyRow[]>('/company').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const payer = companies.data?.find((c) => c.companyCode === 'FINANCE') ?? companies.data?.[0];

  const downloadXlsx = async () => {
    try {
      const res = await api.get(`/tax/export-xlsx?form=PND1A&year=${year}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PND1A-${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const data = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ภ.ง.ด.1ก + ใบ 50 ทวิ — สรุปรายปี"
        icon={<FileBadge className="size-5" />}
      />
      <Card>
        <CardHeader className="flex flex-row gap-3 items-center flex-wrap pb-4">
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[year - 3, year - 2, year - 1, year].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  ปีภาษี {y + 543}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground leading-snug">
            ภ.ง.ด.1ก ยื่นภายใน ก.พ. ปีถัดไป · ใบ 50 ทวิ ต้องส่งให้พนักงานภายใน 15 ก.พ.
          </span>
          <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={downloadXlsx}>
            <Download className="size-3.5" /> ดาวน์โหลด Excel
          </Button>
        </CardHeader>
        <CardContent>
          <QueryBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            onRetry={query.refetch}
          >
            {data && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>ชื่อพนักงาน</TableHead>
                    <TableHead>เลขผู้เสียภาษี</TableHead>
                    <TableHead className="text-right">เดือนที่จ่าย</TableHead>
                    <TableHead className="text-right">เงินได้ทั้งปี</TableHead>
                    <TableHead className="text-right">ภาษีหักทั้งปี</TableHead>
                    <TableHead className="text-right">ปกส. ทั้งปี</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        ไม่มีใบเงินเดือนที่ POST แล้วในปี {year + 543}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {data.items.map((it, i) => (
                        <TableRow key={i}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className="leading-snug">{it.employeeName}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {it.employeeTaxId ?? '—'}
                          </TableCell>
                          <TableCell className="text-right">{it.monthsPaid}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatNumberDecimal(parseFloat(it.grossTotal), 2)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatNumberDecimal(parseFloat(it.whtTotal), 2)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatNumberDecimal(parseFloat(it.ssoTotal), 2)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => setCertFor(it)}
                            >
                              <Printer className="size-3.5" /> 50 ทวิ
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold border-t-2 border-border">
                        <TableCell colSpan={4}>รวม {data.count} คน</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatNumberDecimal(parseFloat(data.grossTotal), 2)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatNumberDecimal(parseFloat(data.whtTotal), 2)}
                        </TableCell>
                        <TableCell colSpan={2}></TableCell>
                      </TableRow>
                      <TableRow className="text-xs text-muted-foreground">
                        <TableCell colSpan={8}>
                          ค่าจ้างรวมทั้งปี (อ้างอิงยื่น กท.20ก กองทุนเงินทดแทน):{' '}
                          <span className="font-mono">
                            {formatNumberDecimal(parseFloat(data.annualWageTotal), 2)} ฿
                          </span>
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>

      {/* ใบรับรองหักภาษี ณ ที่จ่าย ม.50 ทวิ — print sheet */}
      <Dialog open={certFor !== null} onOpenChange={(o) => !o && setCertFor(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {certFor && payer && (
            <>
              <style>{`@media print {
                body * { visibility: hidden !important; }
                #wht-cert-print, #wht-cert-print * { visibility: visible !important; }
                #wht-cert-print { position: fixed; inset: 0; padding: 24px; background: white; }
              }`}</style>
              {/* print/receipt context — เอกสารทางการพิมพ์ขาวดำ จึงใช้สีตรงได้ตามข้อยกเว้นใน rules */}
              <div id="wht-cert-print" className="bg-white text-black p-6 text-sm space-y-4">
                <div className="text-center space-y-1">
                  <h1 className="text-base font-bold leading-snug">
                    หนังสือรับรองการหักภาษี ณ ที่จ่าย
                  </h1>
                  <div className="text-xs">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร — แบบ ภ.ง.ด.1ก</div>
                  <div className="text-xs">ปีภาษี {year + 543}</div>
                </div>

                <div className="border border-black rounded p-3 space-y-1">
                  <div className="font-semibold text-xs">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ผู้จ่ายเงินได้)</div>
                  <div className="leading-snug">{payer.nameTh}</div>
                  <div className="text-xs leading-snug">
                    เลขประจำตัวผู้เสียภาษี {payer.taxId} · {payer.address}
                  </div>
                </div>

                <div className="border border-black rounded p-3 space-y-1">
                  <div className="font-semibold text-xs">ผู้ถูกหักภาษี ณ ที่จ่าย (ผู้รับเงินได้)</div>
                  <div className="leading-snug">{certFor.employeeName}</div>
                  <div className="text-xs">
                    เลขประจำตัวผู้เสียภาษี {certFor.employeeTaxId ?? '................................'}
                  </div>
                </div>

                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border border-black px-2 py-1 text-left">ประเภทเงินได้</th>
                      <th className="border border-black px-2 py-1 text-right w-36">
                        จำนวนเงินที่จ่าย (บาท)
                      </th>
                      <th className="border border-black px-2 py-1 text-right w-36">
                        ภาษีที่หักนำส่ง (บาท)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black px-2 py-1 leading-snug">
                        เงินเดือน ค่าจ้าง ฯลฯ ตามมาตรา 40(1)
                      </td>
                      <td className="border border-black px-2 py-1 text-right font-mono">
                        {formatNumberDecimal(parseFloat(certFor.grossTotal), 2)}
                      </td>
                      <td className="border border-black px-2 py-1 text-right font-mono">
                        {formatNumberDecimal(parseFloat(certFor.whtTotal), 2)}
                      </td>
                    </tr>
                    <tr className="font-semibold">
                      <td className="border border-black px-2 py-1">รวม</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">
                        {formatNumberDecimal(parseFloat(certFor.grossTotal), 2)}
                      </td>
                      <td className="border border-black px-2 py-1 text-right font-mono">
                        {formatNumberDecimal(parseFloat(certFor.whtTotal), 2)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="text-xs leading-snug">
                  เงินสมทบกองทุนประกันสังคมที่หักจากผู้รับเงินได้ในปี:{' '}
                  <span className="font-mono">
                    {formatNumberDecimal(parseFloat(certFor.ssoTotal), 2)}
                  </span>{' '}
                  บาท (ใช้สิทธิลดหย่อนได้)
                </div>

                <div className="pt-6 grid grid-cols-2 gap-6 text-center text-xs">
                  <div>
                    <div className="border-b border-dotted border-black h-10"></div>
                    <div className="mt-1">
                      ลงชื่อ ผู้จ่ายเงิน ({payer.directorName})
                    </div>
                    <div>วันที่ ........./........./.........</div>
                  </div>
                  <div>
                    <div className="border-b border-dotted border-black h-10"></div>
                    <div className="mt-1">ประทับตรา (ถ้ามี)</div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setCertFor(null)}>
                  ปิด
                </Button>
                <Button className="gap-1.5" onClick={() => window.print()}>
                  <Printer className="size-4" /> พิมพ์
                </Button>
              </div>
            </>
          )}
          {certFor && !payer && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              กำลังโหลดข้อมูลบริษัท… (ต้องมี CompanyInfo ฝั่ง FINANCE)
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

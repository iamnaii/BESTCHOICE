import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import CompanyFilter from '@/components/CompanyFilter';
import { THAI_MONTHS_FULL } from '@/lib/date';
import { Calculator, Download } from 'lucide-react';

type WhtForm = 'PND1' | 'PND3' | 'PND53';

const FORM_META: Record<
  WhtForm,
  { title: string; subtitle: string; account: string; party: string }
> = {
  PND1: {
    title: 'ภ.ง.ด.1 — ภาษีหัก ณ ที่จ่ายเงินเดือน',
    subtitle: 'ม.50(1), ม.52/53 ป.รัษฎากร — ยื่นทุกวันที่ 7 ของเดือนถัดไป',
    account: '21-3101',
    party: 'พนักงาน',
  },
  PND3: {
    title: 'ภ.ง.ด.3 — บุคคลธรรมดา',
    subtitle: 'ม.3 เตรส, ม.50(3)(4) — ยื่นทุกวันที่ 7 ของเดือนถัดไป',
    account: '21-3102',
    party: 'ผู้รับเงิน',
  },
  PND53: {
    title: 'ภ.ง.ด.53 — นิติบุคคล',
    subtitle: 'ม.3 เตรส, ทป.4/2528 — ยื่นทุกวันที่ 7 ของเดือนถัดไป',
    account: '21-3103',
    party: 'ผู้รับเงิน',
  },
};

interface WhtItemPersonal {
  employeeName: string;
  employeeTaxId: string | null;
  gross: number | string;
  whtAmount: number | string;
  payDate: string | Date;
  payrollDocNumber: string;
}
interface WhtItemVendor {
  vendorName: string;
  vendorTaxId: string | null;
  incomeType: string | null;
  gross: number | string;
  whtPercent: number | string;
  whtAmount: number | string;
  paidDate: string | Date;
  expenseDocNumber: string;
}
interface WhtPersonalResult {
  items: WhtItemPersonal[];
  grossIncome: number | string;
  whtTotal: number | string;
  count: number;
}
interface WhtVendorResult {
  items: WhtItemVendor[];
  grossIncome: number | string;
  whtTotal: number | string;
  count: number;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden bg-background text-foreground';

function fmtNumber(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return '0.00';
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function endpointFor(form: WhtForm): string {
  if (form === 'PND1') return '/tax/pnd1-preview';
  if (form === 'PND3') return '/tax/pnd3-preview';
  return '/tax/pnd53-preview';
}

function PersonalTable({ items }: { items: WhtItemPersonal[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b border-border">
            <th className="py-2 pr-2">พนักงาน</th>
            <th className="py-2 pr-2">เลขประจำตัวผู้เสียภาษี</th>
            <th className="py-2 pr-2 text-right">เงินได้ (฿)</th>
            <th className="py-2 pr-2 text-right">WHT (฿)</th>
            <th className="py-2 pr-2">วันจ่าย</th>
            <th className="py-2 pr-2">เอกสาร</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-muted-foreground">
                ไม่มีข้อมูลในงวด
              </td>
            </tr>
          )}
          {items.map((it, idx) => (
            <tr key={idx} className="border-b border-border/40">
              <td className="py-2 pr-2">{it.employeeName}</td>
              <td className="py-2 pr-2 font-mono text-xs">{it.employeeTaxId ?? '-'}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(it.gross)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(it.whtAmount)}</td>
              <td className="py-2 pr-2 tabular-nums">
                {it.payDate ? new Date(it.payDate).toLocaleDateString('th-TH') : '-'}
              </td>
              <td className="py-2 pr-2 font-mono text-xs">{it.payrollDocNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VendorTable({ items }: { items: WhtItemVendor[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b border-border">
            <th className="py-2 pr-2">ผู้รับเงิน</th>
            <th className="py-2 pr-2">เลขประจำตัวผู้เสียภาษี</th>
            <th className="py-2 pr-2">ประเภทเงินได้</th>
            <th className="py-2 pr-2 text-right">จำนวนเงิน (฿)</th>
            <th className="py-2 pr-2 text-right">อัตรา</th>
            <th className="py-2 pr-2 text-right">WHT (฿)</th>
            <th className="py-2 pr-2">วันจ่าย</th>
            <th className="py-2 pr-2">เอกสาร</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={8} className="py-4 text-center text-muted-foreground">
                ไม่มีข้อมูลในงวด
              </td>
            </tr>
          )}
          {items.map((it, idx) => (
            <tr key={idx} className="border-b border-border/40">
              <td className="py-2 pr-2">{it.vendorName}</td>
              <td className="py-2 pr-2 font-mono text-xs">{it.vendorTaxId ?? '-'}</td>
              <td className="py-2 pr-2">{it.incomeType ?? '-'}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(it.gross)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(it.whtPercent)}%</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtNumber(it.whtAmount)}</td>
              <td className="py-2 pr-2 tabular-nums">
                {it.paidDate ? new Date(it.paidDate).toLocaleDateString('th-TH') : '-'}
              </td>
              <td className="py-2 pr-2 font-mono text-xs">{it.expenseDocNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormTabContent({
  form,
  companyId,
  year,
  month,
}: {
  form: WhtForm;
  companyId: string;
  year: number;
  month: number;
}) {
  const meta = FORM_META[form];
  const enabled = Boolean(companyId);

  const query = useQuery<WhtPersonalResult | WhtVendorResult>({
    queryKey: ['tax', form.toLowerCase() + '-preview', companyId, year, month],
    enabled,
    queryFn: async () => {
      const url = `${endpointFor(form)}?companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}`;
      const res = await api.get(url);
      return res.data;
    },
  });

  async function handleExport() {
    if (!companyId) {
      toast.error('กรุณาเลือกบริษัทก่อน');
      return;
    }
    try {
      const res = await api.get(
        `/tax/export-xlsx?form=${form}&companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}`,
        { responseType: 'blob' },
      );
      const blob = res.data as Blob;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${form}-${year}-${String(month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message ?? 'ดาวน์โหลด XLSX ล้มเหลว');
    }
  }

  if (!enabled) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground leading-snug">
          กรุณาเลือกบริษัทเพื่อแสดงรายงาน {form}
        </CardContent>
      </Card>
    );
  }

  return (
    <QueryBoundary
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={query.refetch}
    >
      {query.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground leading-snug">บัญชีต้นทาง</p>
                <p className="font-mono text-base font-semibold text-foreground mt-1">
                  {meta.account}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground leading-snug">จำนวนรายการ</p>
                <p className="text-lg font-semibold tabular-nums mt-1">{query.data.count}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground leading-snug">ภาษีหัก ณ ที่จ่าย</p>
                <p className="text-lg font-semibold tabular-nums mt-1 text-primary">
                  {fmtNumber(query.data.whtTotal)} ฿
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground leading-snug">
                รายการ {meta.party}
              </h3>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="size-4 mr-2" aria-hidden />
                Export XLSX
              </Button>
            </CardHeader>
            <CardContent>
              {form === 'PND1' ? (
                <PersonalTable items={(query.data as WhtPersonalResult).items} />
              ) : (
                <VendorTable items={(query.data as WhtVendorResult).items} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </QueryBoundary>
  );
}

export function WhtReportPage() {
  const now = new Date();
  const [companyId, setCompanyId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<WhtForm>('PND1');

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <PageHeader
        title="ภ.ง.ด. 1/3/53 — ภาษีหัก ณ ที่จ่าย"
        subtitle="ยื่นแบบทุกวันที่ 7 ของเดือนถัดไป (V17: ฐานคำนวณ WHT = ราคาก่อน VAT)"
        icon={<Calculator className="size-5" aria-hidden />}
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as WhtForm)}>
        <TabsList className="mb-4" data-testid="wht-tabs">
          <TabsTrigger value="PND1">ภ.ง.ด.1</TabsTrigger>
          <TabsTrigger value="PND3">ภ.ง.ด.3</TabsTrigger>
          <TabsTrigger value="PND53">ภ.ง.ด.53</TabsTrigger>
        </TabsList>

        <p className="text-xs text-muted-foreground leading-snug mb-3">{FORM_META[tab].subtitle}</p>

        <TabsContent value="PND1">
          <FormTabContent form="PND1" companyId={companyId} year={year} month={month} />
        </TabsContent>
        <TabsContent value="PND3">
          <FormTabContent form="PND3" companyId={companyId} year={year} month={month} />
        </TabsContent>
        <TabsContent value="PND53">
          <FormTabContent form="PND53" companyId={companyId} year={year} month={month} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default WhtReportPage;

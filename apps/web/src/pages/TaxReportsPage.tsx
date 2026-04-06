import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import CompanyFilter from '@/components/CompanyFilter';
import { Button } from '@/components/ui/button';
import { FileText, Eye, Download, Loader2, Calendar } from 'lucide-react';

// --- Types ---

interface PP30Preview {
  totalSales: number;
  outputVat: number;
  totalPurchases: number;
  inputVat: number;
  netVat: number;
}

interface PND3Preview {
  totalWht: number;
  totalItems: number;
  vendors: { vendorName: string; taxId: string; totalAmount: number; whtAmount: number }[];
}

interface PND53Preview {
  totalWht: number;
  totalItems: number;
  vendors: { vendorName: string; taxId: string; totalAmount: number; whtAmount: number }[];
}

interface TaxReport {
  id: string;
  reportType: string;
  reportYear: number;
  reportMonth: number;
  status: string;
  fileUrl: string | null;
  createdAt: string;
  generatedBy: { name: string } | null;
}

interface TaxReportsResponse {
  data: TaxReport[];
  total: number;
  page: number;
  limit: number;
}

// --- Helpers ---

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const reportTypeLabels: Record<string, string> = {
  PP30: 'ภ.พ.30',
  PND3: 'ภ.ง.ด.3',
  PND53: 'ภ.ง.ด.53',
};

const statusLabels: Record<string, string> = {
  DRAFT: 'แบบร่าง',
  GENERATED: 'สร้างแล้ว',
  SUBMITTED: 'ยื่นแล้ว',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-warning/10 text-warning',
  GENERATED: 'bg-primary/10 text-primary',
  SUBMITTED: 'bg-success/10 text-success',
};

// --- Sub-components ---

function PP30PreviewCard({ data }: { data: PP30Preview }) {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold">ตัวอย่าง ภ.พ.30</h3>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between py-1.5 border-b border-border">
          <span className="text-muted-foreground">ยอดขาย</span>
          <span className="tabular-nums font-medium">{fmt(data.totalSales)} ฿</span>
        </div>
        <div className="flex justify-between py-1.5 border-b border-border">
          <span className="text-muted-foreground">ภาษีขาย</span>
          <span className="tabular-nums font-medium">{fmt(data.outputVat)} ฿</span>
        </div>
        <div className="flex justify-between py-1.5 border-b border-border">
          <span className="text-muted-foreground">ยอดซื้อ</span>
          <span className="tabular-nums font-medium">{fmt(data.totalPurchases)} ฿</span>
        </div>
        <div className="flex justify-between py-1.5 border-b border-border">
          <span className="text-muted-foreground">ภาษีซื้อ</span>
          <span className="tabular-nums font-medium">{fmt(data.inputVat)} ฿</span>
        </div>
        <div className="flex justify-between py-2 font-semibold text-base border-t-2 border-border mt-2">
          <span>ภาษีสุทธิ</span>
          <span className={`tabular-nums ${data.netVat < 0 ? 'text-destructive' : 'text-success'}`}>
            {fmt(data.netVat)} ฿
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function WhtPreviewCard({ data, title }: { data: PND3Preview | PND53Preview; title: string }) {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold">ตัวอย่าง {title}</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">ยอด WHT รวม</p>
            <p className="text-lg font-bold tabular-nums">{fmt(data.totalWht)} ฿</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">จำนวนรายการ</p>
            <p className="text-lg font-bold tabular-nums">{data.totalItems}</p>
          </div>
        </div>

        {data.vendors.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium text-muted-foreground">ผู้ขาย</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">เลขประจำตัวผู้เสียภาษี</th>
                  <th className="text-right py-2 font-medium text-muted-foreground">ยอดเงิน</th>
                  <th className="text-right py-2 font-medium text-muted-foreground">WHT</th>
                </tr>
              </thead>
              <tbody>
                {data.vendors.map((v, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2">{v.vendorName}</td>
                    <td className="py-2 tabular-nums">{v.taxId}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(v.totalAmount)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(v.whtAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.vendors.length === 0 && (
          <p className="text-center text-muted-foreground py-4">ไม่มีรายการ</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportsList({
  companyId,
  reportType,
}: {
  companyId: string;
  reportType: string;
}) {
  const { data, isLoading } = useQuery<TaxReportsResponse>({
    queryKey: ['tax-reports', companyId, reportType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      params.set('reportType', reportType);
      params.set('limit', '20');
      return (await api.get(`/tax?${params.toString()}`)).data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const reports = data?.data ?? [];

  if (reports.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-6 text-sm">ยังไม่มีรายงานที่สร้างแล้ว</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 font-medium text-muted-foreground">ประเภท</th>
            <th className="text-left py-2 font-medium text-muted-foreground">เดือน/ปี</th>
            <th className="text-left py-2 font-medium text-muted-foreground">สถานะ</th>
            <th className="text-left py-2 font-medium text-muted-foreground">สร้างโดย</th>
            <th className="text-left py-2 font-medium text-muted-foreground">วันที่สร้าง</th>
            <th className="text-right py-2 font-medium text-muted-foreground"></th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-2.5">{reportTypeLabels[r.reportType] ?? r.reportType}</td>
              <td className="py-2.5">
                {MONTHS[r.reportMonth - 1]} {r.reportYear + 543}
              </td>
              <td className="py-2.5">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status] ?? 'bg-muted text-muted-foreground'}`}>
                  {statusLabels[r.status] ?? r.status}
                </span>
              </td>
              <td className="py-2.5 text-muted-foreground">{r.generatedBy?.name ?? '-'}</td>
              <td className="py-2.5 text-muted-foreground tabular-nums">
                {new Date(r.createdAt).toLocaleDateString('th-TH', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </td>
              <td className="py-2.5 text-right">
                {r.fileUrl && (
                  <a
                    href={r.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                  >
                    <Download className="size-3.5" />
                    ดาวน์โหลด
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Tab Content Components ---

function PP30Tab({ companyId, year, month }: { companyId: string; year: number; month: number }) {
  const [previewData, setPreviewData] = useState<PP30Preview | null>(null);

  const previewQuery = useQuery<PP30Preview>({
    queryKey: ['tax-pp30-preview', companyId, year, month],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      params.set('year', String(year));
      params.set('month', String(month));
      return (await api.get(`/tax/pp30-preview?${params.toString()}`)).data;
    },
    enabled: false,
  });

  const generateMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/tax/generate', {
          companyId: companyId || undefined,
          reportType: 'PP30',
          reportYear: year,
          reportMonth: month,
        })
      ).data,
    onSuccess: () => {
      toast.success('สร้างรายงาน ภ.พ.30 สำเร็จ');
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  const handlePreview = async () => {
    try {
      const result = await previewQuery.refetch();
      if (result.data) setPreviewData(result.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={handlePreview} disabled={previewQuery.isFetching} variant="outline">
          {previewQuery.isFetching ? <Loader2 className="size-4 animate-spin mr-2" /> : <Eye className="size-4 mr-2" />}
          ดูตัวอย่าง
        </Button>
        <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          {generateMutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <FileText className="size-4 mr-2" />}
          สร้างรายงาน
        </Button>
      </div>

      {previewData && <PP30PreviewCard data={previewData} />}

      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold">รายงานที่สร้างแล้ว</h3>
        </CardHeader>
        <CardContent>
          <ReportsList companyId={companyId} reportType="PP30" />
        </CardContent>
      </Card>
    </div>
  );
}

function PNDTab({
  companyId,
  year,
  month,
  type,
}: {
  companyId: string;
  year: number;
  month: number;
  type: 'PND3' | 'PND53';
}) {
  const endpoint = type === 'PND3' ? '/tax/pnd3-preview' : '/tax/pnd53-preview';
  const label = type === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53';
  const [previewData, setPreviewData] = useState<PND3Preview | null>(null);

  const previewQuery = useQuery<PND3Preview>({
    queryKey: [`tax-${type.toLowerCase()}-preview`, companyId, year, month],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      params.set('year', String(year));
      params.set('month', String(month));
      return (await api.get(`${endpoint}?${params.toString()}`)).data;
    },
    enabled: false,
  });

  const generateMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/tax/generate', {
          companyId: companyId || undefined,
          reportType: type,
          reportYear: year,
          reportMonth: month,
        })
      ).data,
    onSuccess: () => {
      toast.success(`สร้างรายงาน ${label} สำเร็จ`);
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  const handlePreview = async () => {
    try {
      const result = await previewQuery.refetch();
      if (result.data) setPreviewData(result.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={handlePreview} disabled={previewQuery.isFetching} variant="outline">
          {previewQuery.isFetching ? <Loader2 className="size-4 animate-spin mr-2" /> : <Eye className="size-4 mr-2" />}
          ดูตัวอย่าง
        </Button>
        <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          {generateMutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <FileText className="size-4 mr-2" />}
          สร้างรายงาน
        </Button>
      </div>

      {previewData && <WhtPreviewCard data={previewData} title={label} />}

      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold">รายงานที่สร้างแล้ว</h3>
        </CardHeader>
        <CardContent>
          <ReportsList companyId={companyId} reportType={type} />
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main Page ---

export default function TaxReportsPage() {
  const now = new Date();
  const [companyId, setCompanyId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const years: number[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) {
    years.push(y);
  }

  return (
    <div>
      <PageHeader
        title="รายงานภาษี"
        subtitle="จัดทำ ภ.พ.30, ภ.ง.ด.3, ภ.ง.ด.53"
        icon={<FileText className="size-6" />}
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <CompanyFilter value={companyId} onChange={setCompanyId} />
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                เดือน
              </label>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={inputClass}>
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                ปี
              </label>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y + 543} ({y})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="PP30">
        <TabsList className="mb-4">
          <TabsTrigger value="PP30">ภ.พ.30</TabsTrigger>
          <TabsTrigger value="PND3">ภ.ง.ด.3</TabsTrigger>
          <TabsTrigger value="PND53">ภ.ง.ด.53</TabsTrigger>
        </TabsList>

        <TabsContent value="PP30">
          <PP30Tab companyId={companyId} year={year} month={month} />
        </TabsContent>

        <TabsContent value="PND3">
          <PNDTab companyId={companyId} year={year} month={month} type="PND3" />
        </TabsContent>

        <TabsContent value="PND53">
          <PNDTab companyId={companyId} year={year} month={month} type="PND53" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

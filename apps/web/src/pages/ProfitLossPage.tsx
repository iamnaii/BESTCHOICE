import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, DollarSign, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface PLData {
  period: { start: string; end: string };
  revenue: {
    cashSales: number;
    installmentDownPayments: number;
    installmentPayments: number;
    interestIncome: number;
    lateFeeIncome: number;
    financeDownPayments: number;
    financeReceived: number;
    totalRevenue: number;
  };
  costOfSales: {
    cogsProduct: number;
    cogsRepairParts: number;
    purchaseOrderCost: number;
    totalCOGS: number;
  };
  grossProfit: number;
  sellingExpenses: {
    commission: number;
    advertising: number;
    transport: number;
    packaging: number;
    totalSelling: number;
  };
  adminExpenses: {
    salary: number;
    socialSecurity: number;
    rent: number;
    utilities: number;
    officeSupplies: number;
    depreciation: number;
    insurance: number;
    taxFee: number;
    maintenance: number;
    travel: number;
    telephone: number;
    totalAdmin: number;
  };
  operatingProfit: number;
  otherExpenses: {
    interest: number;
    loss: number;
    fine: number;
    misc: number;
    totalOther: number;
  };
  netProfit: number;
  summary: {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    profitMargin: number;
  };
}

const inputClass = 'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PLRow({ label, amount, bold, indent, sub }: { label: string; amount: number; bold?: boolean; indent?: boolean; sub?: boolean }) {
  const isNeg = amount < 0;
  return (
    <div className={`flex justify-between items-center py-1.5 ${bold ? 'font-semibold border-t border-border pt-2' : ''} ${indent ? 'pl-6' : ''} ${sub ? 'text-muted-foreground text-sm' : ''}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${isNeg ? 'text-destructive' : ''} ${bold ? 'text-base' : 'text-sm'}`}>
        {isNeg ? `(${fmt(Math.abs(amount))})` : fmt(amount)}
      </span>
    </div>
  );
}

function SectionHeader({ title, code }: { title: string; code: string }) {
  return (
    <div className="flex items-center gap-2 pt-4 pb-1 border-b border-border mb-1">
      <span className="text-xs font-mono text-muted-foreground">{code}</span>
      <span className="font-semibold text-foreground">{title}</span>
    </div>
  );
}

export default function ProfitLossPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [branchId, setBranchId] = useState('');

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const { data: pl, isLoading } = useQuery<PLData>({
    queryKey: ['profit-loss', startDate, endDate, branchId],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (branchId) params.set('branchId', branchId);
      return (await api.get(`/reports/profit-loss?${params}`)).data;
    },
    enabled: !!startDate && !!endDate,
  });

  const { data: monthlyData } = useQuery<{ year: number; months: { month: number; label: string; revenue: number; expenses: number; netProfit: number }[] }>({
    queryKey: ['monthly-pl', startDate ? new Date(startDate).getFullYear() : new Date().getFullYear(), branchId],
    queryFn: async () => {
      const year = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear();
      const params = new URLSearchParams({ year: year.toString() });
      if (branchId) params.set('branchId', branchId);
      return (await api.get(`/reports/monthly-pl?${params}`)).data;
    },
  });

  const margin = pl?.summary.profitMargin || 0;
  const isProfit = (pl?.netProfit || 0) >= 0;

  return (
    <div>
      <PageHeader
        title="งบกำไรขาดทุน"
        subtitle="Profit & Loss Statement (ผังบัญชีไทย)"
        icon={<DollarSign className="size-6" />}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ตั้งแต่</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inputClass} w-auto`} />
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ถึง</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`${inputClass} w-auto`} />
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สาขา</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`${inputClass} w-auto min-w-[150px]`}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        {/* Quick presets */}
        <div className="flex items-end gap-1">
          {[
            { label: 'เดือนนี้', fn: () => { setStartDate(firstOfMonth.toISOString().split('T')[0]); setEndDate(now.toISOString().split('T')[0]); } },
            { label: '3 เดือน', fn: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); setStartDate(d.toISOString().split('T')[0]); setEndDate(now.toISOString().split('T')[0]); } },
            { label: 'ปีนี้', fn: () => { setStartDate(`${now.getFullYear()}-01-01`); setEndDate(now.toISOString().split('T')[0]); } },
          ].map((p) => (
            <button key={p.label} onClick={p.fn} className="px-3 py-2 text-xs border border-input rounded-lg hover:bg-muted transition-colors">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : pl ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">รายได้รวม</span>
                  <ArrowUp className="size-4 text-green-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-success">{fmt(pl.summary.totalRevenue)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">ค่าใช้จ่ายรวม</span>
                  <ArrowDown className="size-4 text-red-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">{fmt(pl.summary.totalExpenses)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">กำไรสุทธิ</span>
                  {isProfit ? <TrendingUp className="size-4 text-green-500" /> : <TrendingDown className="size-4 text-red-500" />}
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${isProfit ? 'text-success' : 'text-destructive'}`}>
                  {fmt(pl.netProfit)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">อัตรากำไร</span>
                  <Minus className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${margin >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {margin.toFixed(1)}%
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Chart */}
          {monthlyData?.months && (
            <Card className="mb-6">
              <CardHeader>
                <h2 className="text-lg font-semibold">เปรียบเทียบรายเดือน {monthlyData.year}</h2>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData.months}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => fmt(v as number)} />
                    <Legend />
                    <Bar dataKey="revenue" name="รายได้" fill="#22c55e" />
                    <Bar dataKey="expenses" name="ค่าใช้จ่าย" fill="#ef4444" />
                    <Bar dataKey="netProfit" name="กำไรสุทธิ" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* P&L Statement */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">งบกำไรขาดทุน</h2>
                <span className="text-sm text-muted-foreground">
                  {new Date(startDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {' — '}
                  {new Date(endDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-0">
              {/* Revenue */}
              <SectionHeader title="รายได้" code="4000" />
              <PLRow label="ยอดขายสด" amount={pl.revenue.cashSales} indent />
              <PLRow label="เงินดาวน์ (ผ่อนร้าน)" amount={pl.revenue.installmentDownPayments} indent />
              <PLRow label="ยอดผ่อนที่ชำระแล้ว" amount={pl.revenue.installmentPayments} indent />
              <PLRow label="รายได้ดอกเบี้ย" amount={pl.revenue.interestIncome} indent />
              <PLRow label="ค่าปรับล่าช้า" amount={pl.revenue.lateFeeIncome} indent />
              <PLRow label="เงินดาวน์ (ไฟแนนซ์)" amount={pl.revenue.financeDownPayments} indent />
              <PLRow label="เงินรับจากไฟแนนซ์" amount={pl.revenue.financeReceived} indent />
              <PLRow label="รวมรายได้" amount={pl.revenue.totalRevenue} bold />

              {/* COGS */}
              <SectionHeader title="ต้นทุนขาย" code="5100" />
              <PLRow label="5101 ต้นทุนสินค้า" amount={pl.costOfSales.cogsProduct} indent sub />
              <PLRow label="5102 อะไหล่/ซ่อม" amount={pl.costOfSales.cogsRepairParts} indent sub />
              <PLRow label="ต้นทุนสินค้าที่ขาย (จาก PO)" amount={pl.costOfSales.purchaseOrderCost} indent sub />
              <PLRow label="รวมต้นทุนขาย" amount={pl.costOfSales.totalCOGS} bold />

              <PLRow label="กำไรขั้นต้น" amount={pl.grossProfit} bold />

              {/* Selling Expenses */}
              <SectionHeader title="ค่าใช้จ่ายในการขาย" code="5200" />
              {pl.sellingExpenses.commission > 0 && <PLRow label="5201 ค่าคอมมิชชั่น" amount={pl.sellingExpenses.commission} indent sub />}
              {pl.sellingExpenses.advertising > 0 && <PLRow label="5202 ค่าโฆษณา/การตลาด" amount={pl.sellingExpenses.advertising} indent sub />}
              {pl.sellingExpenses.transport > 0 && <PLRow label="5203 ค่าขนส่ง" amount={pl.sellingExpenses.transport} indent sub />}
              {pl.sellingExpenses.packaging > 0 && <PLRow label="5204 ค่าบรรจุภัณฑ์" amount={pl.sellingExpenses.packaging} indent sub />}
              <PLRow label="รวมค่าใช้จ่ายในการขาย" amount={pl.sellingExpenses.totalSelling} bold />

              {/* Admin Expenses */}
              <SectionHeader title="ค่าใช้จ่ายในการบริหาร" code="5300" />
              {pl.adminExpenses.salary > 0 && <PLRow label="5301 เงินเดือน/ค่าจ้าง" amount={pl.adminExpenses.salary} indent sub />}
              {pl.adminExpenses.socialSecurity > 0 && <PLRow label="5302 ประกันสังคม" amount={pl.adminExpenses.socialSecurity} indent sub />}
              {pl.adminExpenses.rent > 0 && <PLRow label="5303 ค่าเช่าสถานที่" amount={pl.adminExpenses.rent} indent sub />}
              {pl.adminExpenses.utilities > 0 && <PLRow label="5304 ค่าน้ำ/ไฟ/เน็ต" amount={pl.adminExpenses.utilities} indent sub />}
              {pl.adminExpenses.officeSupplies > 0 && <PLRow label="5305 วัสดุสำนักงาน" amount={pl.adminExpenses.officeSupplies} indent sub />}
              {pl.adminExpenses.depreciation > 0 && <PLRow label="5306 ค่าเสื่อมราคา" amount={pl.adminExpenses.depreciation} indent sub />}
              {pl.adminExpenses.insurance > 0 && <PLRow label="5307 ค่าประกันภัย" amount={pl.adminExpenses.insurance} indent sub />}
              {pl.adminExpenses.taxFee > 0 && <PLRow label="5308 ภาษี/ค่าธรรมเนียม" amount={pl.adminExpenses.taxFee} indent sub />}
              {pl.adminExpenses.maintenance > 0 && <PLRow label="5309 ค่าซ่อมบำรุง" amount={pl.adminExpenses.maintenance} indent sub />}
              {pl.adminExpenses.travel > 0 && <PLRow label="5310 ค่าเดินทาง" amount={pl.adminExpenses.travel} indent sub />}
              {pl.adminExpenses.telephone > 0 && <PLRow label="5311 ค่าโทรศัพท์" amount={pl.adminExpenses.telephone} indent sub />}
              <PLRow label="รวมค่าใช้จ่ายในการบริหาร" amount={pl.adminExpenses.totalAdmin} bold />

              <PLRow label="กำไรจากการดำเนินงาน" amount={pl.operatingProfit} bold />

              {/* Other Expenses */}
              <SectionHeader title="ค่าใช้จ่ายอื่น" code="5900" />
              {pl.otherExpenses.interest > 0 && <PLRow label="5901 ดอกเบี้ยจ่าย" amount={pl.otherExpenses.interest} indent sub />}
              {pl.otherExpenses.loss > 0 && <PLRow label="5902 ขาดทุนจำหน่ายสินทรัพย์" amount={pl.otherExpenses.loss} indent sub />}
              {pl.otherExpenses.fine > 0 && <PLRow label="5903 ค่าปรับ" amount={pl.otherExpenses.fine} indent sub />}
              {pl.otherExpenses.misc > 0 && <PLRow label="5999 เบ็ดเตล็ด" amount={pl.otherExpenses.misc} indent sub />}
              <PLRow label="รวมค่าใช้จ่ายอื่น" amount={pl.otherExpenses.totalOther} bold />

              {/* Net Profit */}
              <div className={`flex justify-between items-center py-3 mt-3 border-t-2 border-double border-foreground ${isProfit ? 'text-success' : 'text-destructive'}`}>
                <span className="text-lg font-bold">กำไรสุทธิ (Net Profit)</span>
                <span className="text-lg font-bold tabular-nums">{fmt(pl.netProfit)}</span>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

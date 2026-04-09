import { useState, useMemo, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { Download, RotateCcw } from 'lucide-react';
import { formatDateShort } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';

interface Sale {
  id: string;
  saleNumber: string;
  saleType: string;
  sellingPrice: string;
  discount: string;
  netAmount: string;
  paymentMethod: string;
  amountReceived: string;
  downPaymentAmount: string | null;
  financeCompany: string | null;
  financeRefNumber: string | null;
  financeAmount: string | null;
  notes: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string; imeiSerial: string | null; serialNumber: string | null; costPrice?: string };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  contract: { id: string; contractNumber: string; status: string; monthlyPayment: string; totalMonths: number } | null;
}

interface SalesSummary {
  totalAmount: number;
  totalDiscount: number;
  totalProfit: number;
  cashCount: number;
  cashAmount: number;
  installmentCount: number;
  installmentAmount: number;
  financeCount: number;
  financeAmount: number;
}

interface SalesResponse {
  data: Sale[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: SalesSummary;
}

const saleTypeLabels: Record<string, { label: string; className: string }> = {
  CASH: { label: 'เงินสด', className: 'bg-success/10 text-success dark:bg-success/15' },
  INSTALLMENT: { label: 'ผ่อนร้าน', className: 'bg-primary/10 text-primary dark:bg-primary/15' },
  EXTERNAL_FINANCE: { label: 'ไฟแนนซ์', className: 'bg-primary/10 text-primary dark:bg-primary/15' },
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

const contractStatusLabels: Record<string, string> = {
  ACTIVE: 'ใช้งาน',
  OVERDUE: 'ค้างชำระ',
  DEFAULT: 'ผิดนัด',
  COMPLETED: 'ปิดแล้ว',
  DRAFT: 'ร่าง',
};

export default function SalesHistoryPage() {
  useDocumentTitle('รายการขาย');
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const isOwnerOrManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  // Filter states
  const [saleTypeFilter, setSaleTypeFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('');
  const [salespersonFilter, setSalespersonFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [contractStatusFilter, setContractStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(searchInput, 400);
  const limit = 20;

  useEffect(() => {
    setSearch(debouncedSearch);
  }, [debouncedSearch]);

  // Reset page when any filter changes
  useEffect(() => {
    setPage(1);
  }, [search, saleTypeFilter, startDate, endDate, paymentMethodFilter, salespersonFilter, branchFilter, contractStatusFilter]);

  const buildParams = (overrideLimit?: number) => {
    const params = new URLSearchParams();
    if (saleTypeFilter) params.set('saleType', saleTypeFilter);
    if (search) params.set('search', search);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (paymentMethodFilter) params.set('paymentMethod', paymentMethodFilter);
    if (salespersonFilter) params.set('salespersonId', salespersonFilter);
    if (branchFilter) params.set('branchId', branchFilter);
    if (contractStatusFilter) params.set('contractStatus', contractStatusFilter);
    params.set('page', String(page));
    if (overrideLimit) params.set('limit', String(overrideLimit));
    else params.set('limit', String(limit));
    return params;
  };

  const {
    data: salesData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<SalesResponse>({
    queryKey: ['sales-history', saleTypeFilter, search, startDate, endDate, paymentMethodFilter, salespersonFilter, branchFilter, contractStatusFilter, page],
    queryFn: async () => {
      const { data } = await api.get(`/sales?${buildParams()}`);
      return data;
    },
  });

  // Fetch salespersons for OWNER/BRANCH_MANAGER
  const { data: salespersons = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['salespersons'],
    queryFn: async () => (await api.get('/sales/salespersons')).data,
    enabled: !!isOwnerOrManager,
  });

  // Fetch branches for OWNER
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: !!isOwner,
  });

  const summary = salesData?.summary;

  // Date shortcut buttons
  const setDateRange = (type: 'today' | 'week' | 'month') => {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    setEndDate(fmt(now));
    if (type === 'today') {
      setStartDate(fmt(now));
    } else if (type === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      setStartDate(fmt(d));
    } else {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(fmt(d));
    }
  };

  const clearFilters = () => {
    setSaleTypeFilter('');
    setSearchInput('');
    setSearch('');
    setStartDate('');
    setEndDate('');
    setPaymentMethodFilter('');
    setSalespersonFilter('');
    setBranchFilter('');
    setContractStatusFilter('');
  };

  const hasActiveFilters = saleTypeFilter || search || startDate || endDate || paymentMethodFilter || salespersonFilter || branchFilter || contractStatusFilter;

  // Excel export
  const exportExcel = async () => {
    try {
      toast.loading('กำลังสร้างไฟล์ Excel...', { id: 'excel-export' });
      const { data: allData } = await api.get<SalesResponse>(`/sales?${buildParams(10000)}`);

      const baseCols: ExcelColumn[] = [
        { header: 'เลขที่ขาย', key: 'saleNumber', width: 18 },
        { header: 'วันที่', key: 'date', width: 14 },
        { header: 'ประเภท', key: 'saleType', width: 12 },
        { header: 'ยี่ห้อ/รุ่น', key: 'product', width: 25 },
        { header: 'IMEI/SN', key: 'imei', width: 20 },
        { header: 'ลูกค้า', key: 'customer', width: 20 },
        { header: 'เบอร์โทร', key: 'phone', width: 14 },
        { header: 'ราคาขาย', key: 'sellingPrice', width: 14 },
        { header: 'ส่วนลด', key: 'discount', width: 12 },
        { header: 'ยอดสุทธิ', key: 'netAmount', width: 14 },
        { header: 'วิธีชำระ', key: 'paymentMethod', width: 14 },
        { header: 'เงินดาวน์', key: 'downPayment', width: 14 },
        { header: 'ค่างวด', key: 'monthlyPayment', width: 14 },
        { header: 'จำนวนงวด', key: 'totalMonths', width: 10 },
        { header: 'เลขสัญญา', key: 'contractNumber', width: 18 },
        { header: 'สถานะสัญญา', key: 'contractStatus', width: 12 },
        { header: 'บริษัทไฟแนนซ์', key: 'financeCompany', width: 18 },
        { header: 'ยอดไฟแนนซ์', key: 'financeAmount', width: 14 },
        { header: 'เลขอ้างอิง', key: 'financeRef', width: 18 },
        { header: 'พนักงาน', key: 'salesperson', width: 16 },
        { header: 'สาขา', key: 'branch', width: 14 },
      ];

      if (isOwner) {
        baseCols.push(
          { header: 'ทุนสินค้า', key: 'costPrice', width: 14 },
          { header: 'กำไร', key: 'profit', width: 14 },
        );
      }

      const now = new Date();
      await exportToExcel({
        columns: baseCols,
        data: allData.data.map((s: Sale) => {
          const row: Record<string, unknown> = {
            saleNumber: s.saleNumber,
            date: formatDateShort(s.createdAt),
            saleType: saleTypeLabels[s.saleType]?.label || s.saleType,
            product: `${s.product.brand} ${s.product.model}`,
            imei: s.product.imeiSerial || s.product.serialNumber || '-',
            customer: s.customer.name,
            phone: s.customer.phone,
            sellingPrice: Number(s.sellingPrice),
            discount: Number(s.discount),
            netAmount: Number(s.netAmount),
            paymentMethod: paymentMethodLabels[s.paymentMethod] || s.paymentMethod || '-',
            downPayment: s.downPaymentAmount ? Number(s.downPaymentAmount) : '-',
            monthlyPayment: s.contract ? Number(s.contract.monthlyPayment) : '-',
            totalMonths: s.contract?.totalMonths || '-',
            contractNumber: s.contract?.contractNumber || '-',
            contractStatus: s.contract ? (contractStatusLabels[s.contract.status] || s.contract.status) : '-',
            financeCompany: s.financeCompany || '-',
            financeAmount: s.financeAmount ? Number(s.financeAmount) : '-',
            financeRef: s.financeRefNumber || '-',
            salesperson: s.salesperson.name,
            branch: s.branch.name,
          };
          if (isOwner) {
            row.costPrice = s.product.costPrice ? Number(s.product.costPrice) : '-';
            row.profit = s.product.costPrice ? Number(s.netAmount) - Number(s.product.costPrice) : '-';
          }
          return row;
        }),
        sheetName: 'ประวัติการขาย',
        filename: `ประวัติการขาย_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`,
      });
      toast.success(`ดาวน์โหลดสำเร็จ (${allData.data.length} รายการ)`, { id: 'excel-export' });
    } catch {
      toast.error('ไม่สามารถสร้างไฟล์ Excel ได้', { id: 'excel-export' });
    }
  };

  const columns = useMemo(() => [
    {
      key: 'index',
      label: '#',
      render: (_s: Sale, _col: unknown, idx?: number) => (
        <span className="text-xs text-muted-foreground">{((salesData?.page ?? 1) - 1) * limit + (idx ?? 0) + 1}</span>
      ),
    },
    {
      key: 'saleNumber',
      label: 'เลขที่',
      render: (s: Sale) => (
        <span className="font-mono text-sm text-primary font-medium">{s.saleNumber}</span>
      ),
    },
    {
      key: 'createdAt',
      label: 'วันที่',
      render: (s: Sale) => (
        <div>
          <div className="text-sm">{formatDateShort(s.createdAt)}</div>
          <div className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      ),
    },
    {
      key: 'saleType',
      label: 'ประเภท',
      render: (s: Sale) => {
        const st = saleTypeLabels[s.saleType] || { label: s.saleType, className: 'bg-muted text-foreground' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.className}`}>{st.label}</span>;
      },
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (s: Sale) => (
        <div>
          <div className="text-sm font-medium">{s.product.brand} {s.product.model}</div>
          {(s.product.imeiSerial || s.product.serialNumber) && (
            <div className="text-xs text-muted-foreground font-mono">{s.product.imeiSerial || s.product.serialNumber}</div>
          )}
        </div>
      ),
    },
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (s: Sale) => (
        <button onClick={(e) => { e.stopPropagation(); navigate(`/customers/${s.customer.id}`); }} className="text-left hover:underline">
          <div className="text-sm text-primary">{s.customer.name}</div>
          <div className="text-xs text-muted-foreground">{s.customer.phone}</div>
        </button>
      ),
    },
    {
      key: 'netAmount',
      label: 'ยอดสุทธิ',
      render: (s: Sale) => (
        <div>
          <div className="text-sm font-medium">{Number(s.netAmount).toLocaleString()} ฿</div>
          {Number(s.discount) > 0 && (
            <div className="text-xs text-red-500">ลด {Number(s.discount).toLocaleString()} ฿</div>
          )}
        </div>
      ),
    },
    // Profit column — OWNER only
    ...(isOwner ? [{
      key: 'profit',
      label: 'กำไร',
      render: (s: Sale) => {
        if (!s.product.costPrice) return <span className="text-xs text-muted-foreground">-</span>;
        const profit = Number(s.netAmount) - Number(s.product.costPrice);
        return (
          <span className={`text-sm font-medium ${profit >= 0 ? 'text-success' : 'text-destructive'}`}>
            {profit >= 0 ? '+' : ''}{profit.toLocaleString()} ฿
          </span>
        );
      },
    }] : []),
    {
      key: 'payment',
      label: 'การชำระ',
      render: (s: Sale) => (
        <div className="text-xs">
          <div>{paymentMethodLabels[s.paymentMethod] || s.paymentMethod || '-'}</div>
          {s.saleType === 'INSTALLMENT' && s.contract && (
            <div className="text-primary">
              ดาวน์ {Number(s.downPaymentAmount || 0).toLocaleString()} ฿
              <br />ผ่อน {Number(s.contract.monthlyPayment).toLocaleString()} x {s.contract.totalMonths} งวด
            </div>
          )}
          {s.saleType === 'EXTERNAL_FINANCE' && s.financeCompany && (
            <div className="text-primary">
              {s.financeCompany}
              {s.financeAmount && Number(s.financeAmount) > 0 && (
                <div>ยอดไฟแนนซ์ {Number(s.financeAmount).toLocaleString()} ฿</div>
              )}
              {s.financeRefNumber && (
                <div className="text-muted-foreground">Ref: {s.financeRefNumber}</div>
              )}
              {s.downPaymentAmount && Number(s.downPaymentAmount) > 0 && (
                <div>ดาวน์ {Number(s.downPaymentAmount).toLocaleString()} ฿</div>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'contract',
      label: 'สัญญา',
      render: (s: Sale) => {
        if (!s.contract) return <span className="text-xs text-muted-foreground">-</span>;
        const statusMap: Record<string, { label: string; cls: string }> = {
          DRAFT: { label: 'ร่าง', cls: 'text-muted-foreground' },
          ACTIVE: { label: 'ใช้งาน', cls: 'text-success' },
          OVERDUE: { label: 'ค้างชำระ', cls: 'text-destructive' },
          DEFAULT: { label: 'ผิดนัด', cls: 'text-destructive font-semibold' },
          COMPLETED: { label: 'ปิดแล้ว', cls: 'text-muted-foreground' },
        };
        const cs = statusMap[s.contract.status] || { label: s.contract.status, cls: 'text-muted-foreground' };
        return (
          <div className="text-xs">
            <div className="font-mono text-primary">{s.contract.contractNumber}</div>
            <div className={cs.cls}>{cs.label}</div>
          </div>
        );
      },
    },
    {
      key: 'salesperson',
      label: 'พนักงาน',
      render: (s: Sale) => <span className="text-xs">{s.salesperson.name}</span>,
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (s: Sale) => <span className="text-xs">{s.branch.name}</span>,
    },
  ], [navigate, salesData?.page, limit, isOwner]);

  const inputClass = 'px-3 py-2 border border-input rounded-lg text-sm bg-background';

  return (
    <div>
      <PageHeader title="ประวัติการขาย" subtitle="ดูรายการขายทั้งหมด" />

      {/* Summary Cards */}
      {summary && salesData && (
        <div className={`grid grid-cols-2 ${isOwner ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-5 lg:gap-7.5 mb-6`}>
          <Card className="border-l-[3px] border-l-foreground hover:shadow-card-hover transition-all">
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ทั้งหมด {salesData.total.toLocaleString()} รายการ</div>
              <div className="text-xl font-bold">{summary.totalAmount.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">฿</span></div>
              {summary.totalDiscount > 0 && <div className="text-xs text-red-500">ส่วนลดรวม {summary.totalDiscount.toLocaleString()} ฿</div>}
            </CardContent>
          </Card>
          <Card className="border-l-[3px] border-l-success hover:shadow-card-hover transition-all">
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เงินสด</div>
              <div className="text-xl font-bold text-success">{summary.cashCount}</div>
              <div className="text-sm text-success mt-1">{summary.cashAmount.toLocaleString()} ฿</div>
            </CardContent>
          </Card>
          <Card className="border-l-[3px] border-l-primary hover:shadow-card-hover transition-all">
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ผ่อนร้าน</div>
              <div className="text-xl font-bold text-primary">{summary.installmentCount}</div>
              <div className="text-sm text-primary mt-1">{summary.installmentAmount.toLocaleString()} ฿</div>
            </CardContent>
          </Card>
          <Card className="border-l-[3px] border-l-primary hover:shadow-card-hover transition-all">
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ไฟแนนซ์</div>
              <div className="text-xl font-bold text-primary">{summary.financeCount}</div>
              <div className="text-sm text-primary mt-1">{summary.financeAmount.toLocaleString()} ฿</div>
            </CardContent>
          </Card>
          {isOwner && (
            <Card className="border-l-[3px] border-l-warning hover:shadow-card-hover transition-all">
              <CardContent className="p-5">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">กำไรรวม</div>
                <div className={`text-xl font-bold ${summary.totalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {summary.totalProfit >= 0 ? '+' : ''}{summary.totalProfit.toLocaleString()} <span className="text-sm font-normal">฿</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="bg-card rounded-lg border border-border/60 p-4 mb-6">
        {/* Row 1: Search + Type + Payment Method + Contract Status */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="ค้นหาเลขที่ขาย, ลูกค้า, สินค้า, ไฟแนนซ์..."
            className={`${inputClass} md:col-span-1`}
          />
          <select
            value={saleTypeFilter}
            onChange={(e) => setSaleTypeFilter(e.target.value)}
            className={inputClass}
          >
            <option value="">ทุกประเภท</option>
            <option value="CASH">เงินสด</option>
            <option value="INSTALLMENT">ผ่อนร้าน</option>
            <option value="EXTERNAL_FINANCE">ไฟแนนซ์</option>
          </select>
          <select
            value={paymentMethodFilter}
            onChange={(e) => setPaymentMethodFilter(e.target.value)}
            className={inputClass}
          >
            <option value="">ทุกวิธีชำระ</option>
            <option value="CASH">เงินสด</option>
            <option value="BANK_TRANSFER">โอนเงิน</option>
            <option value="QR_EWALLET">QR/E-Wallet</option>
          </select>
          <select
            value={contractStatusFilter}
            onChange={(e) => setContractStatusFilter(e.target.value)}
            className={inputClass}
          >
            <option value="">ทุกสถานะสัญญา</option>
            <option value="ACTIVE">ใช้งาน</option>
            <option value="OVERDUE">ค้างชำระ</option>
            <option value="DEFAULT">ผิดนัด</option>
            <option value="COMPLETED">ปิดแล้ว</option>
            <option value="DRAFT">ร่าง</option>
          </select>
        </div>

        {/* Row 2: Date filters + shortcuts + Excel */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <ThaiDateInput
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={`${inputClass} w-40`}
          />
          <span className="text-sm text-muted-foreground">ถึง</span>
          <ThaiDateInput
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={`${inputClass} w-40`}
          />
          <div className="flex gap-1.5">
            <button onClick={() => setDateRange('today')} className="px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent transition-colors">วันนี้</button>
            <button onClick={() => setDateRange('week')} className="px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent transition-colors">สัปดาห์นี้</button>
            <button onClick={() => setDateRange('month')} className="px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent transition-colors">เดือนนี้</button>
          </div>
          <div className="ml-auto flex gap-2">
            {hasActiveFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent transition-colors text-muted-foreground">
                <RotateCcw className="w-3.5 h-3.5" />
                ล้างตัวกรอง
              </button>
            )}
            <button onClick={exportExcel} className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium">
              <Download className="w-3.5 h-3.5" />
              ส่งออก Excel
            </button>
          </div>
        </div>

        {/* Row 3: Salesperson + Branch (role-based) */}
        {isOwnerOrManager && (
          <div className="flex flex-wrap gap-3">
            <select
              value={salespersonFilter}
              onChange={(e) => setSalespersonFilter(e.target.value)}
              className={inputClass}
            >
              <option value="">ทุกพนักงาน</option>
              {salespersons.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
            {isOwner && (
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className={inputClass}
              >
                <option value="">ทุกสาขา</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Sales Table */}
      <QueryBoundary
        isLoading={isLoading && !salesData}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดประวัติการขายได้"
      >
        <DataTable
          columns={columns}
          data={salesData?.data || []}
          isLoading={isLoading}
          emptyMessage="ยังไม่มีรายการขาย"
          onRowClick={(sale) => sale.contract ? navigate(`/contracts/${sale.contract.id}`) : undefined}
          pagination={salesData ? {
            page: salesData.page,
            totalPages: salesData.totalPages,
            total: salesData.total,
            onPageChange: setPage,
          } : undefined}
        />
      </QueryBoundary>
    </div>
  );
}

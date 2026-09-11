import { saleMargin } from '@/lib/sale-margin';
import { BookingSaleReceipt, type BookingSaleReceiptData } from '@/components/sales/BookingSaleReceipt';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { invalidateSalesQueries } from '@/lib/invalidate-sales-queries';
import { computeDefaultTimeRange, formatThaiDateTime } from '@/lib/date';
import { createExportGuard, ExportError, fetchExportSnapshot, type ExportSnapshot } from '@/lib/fetch-export-pages';
import { useState, useMemo, useEffect, useRef } from 'react';
import type { TradeInCreditSnapshot } from '@installment/shared';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, saleTypeMap, contractStatusMap } from '@/lib/status-badges';
import { Download, RotateCcw, Ban } from 'lucide-react';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch, SwitchWrapper } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

/** ตรงกับ `VoidSaleDto.reason` ฝั่ง API (MinLength 10) — กันยิงคำขอที่ 400 แน่ ๆ */
const VOID_REASON_MIN = 10;
/** ใบ INSTALLMENT ยกเลิกผ่านเส้นทางยกเลิกสัญญา — API ปฏิเสธอยู่แล้ว จึงซ่อนปุ่ม */
const VOIDABLE_SALE_TYPES = new Set(['CASH', 'EXTERNAL_FINANCE']);

interface Sale {
  costPriceSnapshot?: string | null;
  receiptBreakdown?: BookingSaleReceiptData | null;
  tradeInCreditSnapshot?: TradeInCreditSnapshot | null;
  id: string;
  saleNumber: string;
  saleType: string;
  sellingPrice: string;
  discount: string;
  netAmount: string;
  paymentMethod: string;
  amountReceived: string | null;
  downPaymentAmount: string | null;
  financeCompany: string | null;
  financeRefNumber: string | null;
  financeAmount: string | null;
  notes: string | null;
  createdAt: string;
  /** เวลาที่ยกเลิก (void = soft delete) — null = ใบยังใช้อยู่ */
  deletedAt?: string | null;
  voidReason?: string | null;
  voidedBy?: { id: string; name: string } | null;
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
  missingCostCount?: number;
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

const saleTypeLabels: Record<string, string> = {
  CASH: 'เงินสด',
  INSTALLMENT: 'ผ่อนร้าน',
  EXTERNAL_FINANCE: 'ไฟแนนซ์',
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};


export default function SalesHistoryPage() {
  useDocumentTitle('รายการขาย');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const saleId = searchParams.get('saleId');
  const saleOpenerId = useRef<string | null>(null);
  const saleListRegion = useRef<HTMLDivElement>(null);
  const openSale = (id: string) => setSearchParams(previous => {
    const next = new URLSearchParams(previous); next.set('saleId', id); return next;
  });
  const saleDetail = useQuery<Sale>({
    queryKey: ['sale', saleId], enabled: !!saleId,
    queryFn: async () => (await api.get(`/sales/${encodeURIComponent(saleId!)}`)).data,
  });
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
  const [includeVoided, setIncludeVoided] = useState(false);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(searchInput, 400);
  const limit = 20;
  const queryClient = useQueryClient();

  // Void dialog state
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const voidReasonOk = voidReason.trim().length >= VOID_REASON_MIN;

  useEffect(() => {
    setSearch(debouncedSearch);
  }, [debouncedSearch]);

  // Reset page when any filter changes
  useEffect(() => {
    setPage(1);
  }, [search, saleTypeFilter, startDate, endDate, paymentMethodFilter, salespersonFilter, branchFilter, contractStatusFilter, includeVoided]);

  const buildParams = (targetPage = page, targetLimit = limit) => {
    const params = new URLSearchParams();
    if (includeVoided) params.set('includeVoided', 'true');
    if (saleTypeFilter) params.set('saleType', saleTypeFilter);
    if (search) params.set('search', search);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (paymentMethodFilter) params.set('paymentMethod', paymentMethodFilter);
    if (salespersonFilter) params.set('salespersonId', salespersonFilter);
    if (branchFilter) params.set('branchId', branchFilter);
    if (contractStatusFilter) params.set('contractStatus', contractStatusFilter);
    params.set('page', String(targetPage));
    params.set('limit', String(targetLimit));
    return params;
  };

  const {
    data: salesData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<SalesResponse>({
    queryKey: ['sales-history', saleTypeFilter, search, startDate, endDate, paymentMethodFilter, salespersonFilter, branchFilter, contractStatusFilter, includeVoided, page],
    queryFn: async () => {
      const { data } = await api.get(`/sales?${buildParams()}`);
      return data;
    },
  });

  useEffect(() => {
    if (salesData && page > Math.max(1, salesData.totalPages)) setPage(Math.max(1, salesData.totalPages));
  }, [salesData, page]);
  const voidMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await api.post<{ saleNumber: string; restoredProductIds: string[]; reversalEntryNumbers: string[] }>(
        `/sales/${id}/void`,
        { reason },
      );
      return data;
    },
    onSuccess: (data) => {
      toast.success(`ยกเลิกใบขาย ${data.saleNumber} แล้ว — คืนสินค้าเข้าสต็อก ${data.restoredProductIds.length} รายการ`);
      setVoidTarget(null);
      setVoidReason('');
      void invalidateSalesQueries(queryClient, 'sale-voided');
    },
    // ข้อความจาก server ชี้ทางออกของแต่ละด่านอยู่แล้ว — แสดงตรง ๆ ไม่เขียนทับ
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const openVoidDialog = (sale: Sale) => {
    setVoidReason('');
    setVoidTarget(sale);
  };

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
  const setDateRange = (type: 'today' | 'week' | 'month' | 'last_month') => {
    const range = computeDefaultTimeRange(type === 'week' ? 'this_week' : type === 'month' ? 'this_month' : type);
    setStartDate(range.startDate); setEndDate(range.endDate);
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
    setIncludeVoided(false);
  };

  const hasActiveFilters = saleTypeFilter || search || startDate || endDate || paymentMethodFilter || salespersonFilter || branchFilter || contractStatusFilter || includeVoided;

  const [isExporting, setIsExporting] = useState(false);
  // Excel export
  const exportExcel = async () => {
    const assertCurrent = createExportGuard();
    try {
      setIsExporting(true);
      toast.loading('กำลังสร้างไฟล์ Excel...', { id: 'excel-export' });
      const snapshot = await fetchExportSnapshot<Sale>(async () =>
        (await api.get<ExportSnapshot<Sale>>(`/sales/export?${buildParams(1, 50)}`, { timeout: 65_000 })).data, assertCurrent);
      const allRows = snapshot.data;

      const baseCols: ExcelColumn[] = [
        { header: 'ใบจองต้นทาง', key: 'bookingNumber', width: 20 },
        { header: 'มัดจำที่รับไว้แล้ว', key: 'bookingDeposit', width: 18 },
        { header: 'วิธีรับมัดจำ', key: 'bookingDepositMethod', width: 18 },
        { header: 'รับเพิ่มเมื่อขาย', key: 'bookingBalance', width: 18 },
        { header: 'วิธีรับยอดเพิ่ม', key: 'bookingBalanceMethod', width: 18 },
        { header: 'สถานะหลักฐานใบจอง', key: 'bookingEvidence', width: 24 },
        { header: 'เลขที่ขาย', key: 'saleNumber', width: 18 },
        { header: 'วันที่', key: 'date', width: 14 },
        { header: 'ข้อมูล ณ (เวลาไทย)', key: 'fetchedAt', width: 24 },
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
        { header: 'เงินสด/โอนสุทธิ (รายการเทิร์น)', key: 'tradeCash', width: 20 },
        { header: 'มูลค่าเครื่องเทิร์น', key: 'tradeBase', width: 18 },
        { header: 'โบนัสเทิร์น (รวมในส่วนลด)', key: 'tradeBonus', width: 22 },
        { header: 'ใบรับเครื่องเทิร์น', key: 'tradeVoucher', width: 22 },
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
          { header: 'ต้นทุนเครื่อง ณ วันขาย', key: 'costPrice', width: 14 },
          { header: 'กำไรเครื่อง (เฉพาะต้นทุนที่ทราบ)', key: 'profit', width: 14 },
        );
      }
      // เปิดสวิตช์ = ไฟล์ปนใบยกเลิก ⇒ ต้องมีคอลัมน์แยกให้บัญชีเห็น; ปิดสวิตช์ = คอลัมน์เดิมทุกประการ
      if (includeVoided) {
        baseCols.push(
          { header: 'สถานะใบ', key: 'voidStatus', width: 12 },
          { header: 'ยกเลิกเมื่อ', key: 'voidedAt', width: 18 },
          { header: 'เหตุผลยกเลิก', key: 'voidReason', width: 30 },
          { header: 'ผู้ยกเลิก', key: 'voidedBy', width: 16 },
        );
      }

      const now = new Date();
      await exportToExcel({
        assertCurrent,
        columns: baseCols,
        data: allRows.map((s: Sale) => {
          const row: Record<string, unknown> = {
            saleNumber: s.saleNumber,
            bookingNumber: s.receiptBreakdown?.bookingNumber ?? '-',
            bookingDeposit: s.receiptBreakdown?.depositAmount != null ? Number(s.receiptBreakdown.depositAmount) : '-',
            bookingDepositMethod: paymentMethodLabels[s.receiptBreakdown?.depositMethod ?? ''] ?? '-',
            bookingBalance: s.receiptBreakdown?.additionalAmount != null ? Number(s.receiptBreakdown.additionalAmount) : '-',
            bookingBalanceMethod: paymentMethodLabels[s.receiptBreakdown?.additionalMethod ?? ''] ?? '-',
            bookingEvidence: s.receiptBreakdown ? s.receiptBreakdown.needsReview ? 'รอตรวจสอบหลักฐาน' : 'ครบถ้วน' : '-',

            fetchedAt: formatThaiDateTime(snapshot.asOf, 'Asia/Bangkok'),
            date: formatDateShort(s.createdAt),
            saleType: saleTypeLabels[s.saleType] || s.saleType,
            product: `${s.product.brand} ${s.product.model}`,
            imei: s.product.imeiSerial || s.product.serialNumber || '-',
            customer: s.customer.name,
            phone: s.customer.phone,
            sellingPrice: Number(s.sellingPrice),
            discount: Number(s.discount),
            netAmount: Number(s.netAmount),
            paymentMethod: s.receiptBreakdown ? 'ดูรายละเอียดใบจอง' : paymentMethodLabels[s.paymentMethod] || s.paymentMethod || '-',
            downPayment: !s.receiptBreakdown && s.downPaymentAmount != null ? Number(s.downPaymentAmount) : '-',
            tradeCash: s.tradeInCreditSnapshot ? Number(s.tradeInCreditSnapshot.cashDownAmount) : '-',
            tradeBase: s.tradeInCreditSnapshot ? Number(s.tradeInCreditSnapshot.baseAmount) : '-',
            tradeBonus: s.tradeInCreditSnapshot ? Number(s.tradeInCreditSnapshot.bonusAmount) : '-',
            tradeVoucher: s.tradeInCreditSnapshot?.voucherNumber ?? s.tradeInCreditSnapshot?.tradeInId ?? '-',
            monthlyPayment: s.contract ? Number(s.contract.monthlyPayment) : '-',
            totalMonths: s.contract?.totalMonths || '-',
            contractNumber: s.contract?.contractNumber || '-',
            contractStatus: s.contract ? (contractStatusMap[s.contract.status]?.label || s.contract.status) : '-',
            financeCompany: s.financeCompany || '-',
            financeAmount: s.financeAmount ? Number(s.financeAmount) : '-',
            financeRef: s.financeRefNumber || '-',
            salesperson: s.salesperson.name,
            branch: s.branch.name,
          };
          if (isOwner) {
            row.costPrice = s.costPriceSnapshot != null ? Number(s.costPriceSnapshot) : '-';
            row.profit = s.costPriceSnapshot != null ? saleMargin(s.netAmount, s.costPriceSnapshot)! : '-';
          }
          if (includeVoided) {
            row.voidStatus = s.deletedAt ? 'ยกเลิกแล้ว' : 'ใช้อยู่';
            row.voidedAt = s.deletedAt ? formatDateTime(s.deletedAt) : '-';
            row.voidReason = s.voidReason || '-';
            row.voidedBy = s.voidedBy?.name || '-';
          }
          return row;
        }),
        sheetName: 'ประวัติการขาย',
        filename: `ประวัติการขาย_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`,
      });
      toast.success(`ดาวน์โหลดสำเร็จ (${allRows.length} รายการ)`, { id: 'excel-export' });
    } catch (error) {
      toast.error(error instanceof ExportError ? error.message : getErrorMessage(error), { id: 'excel-export' });
    } finally { setIsExporting(false); }
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
        <div className="space-y-1">
          <Link data-sale-id={s.id} to={`/sales?${new URLSearchParams({ ...Object.fromEntries(searchParams), saleId: s.id })}`} onClick={event => { event.stopPropagation(); saleOpenerId.current = s.id; }} className={`font-mono text-sm font-medium hover:underline ${s.deletedAt ? 'text-muted-foreground line-through' : 'text-primary'}`}>
            {s.saleNumber}
          </Link>
          {s.deletedAt && (
            <div className="text-xs leading-snug space-y-0.5">
              <Badge variant="destructive" size="sm">ยกเลิกแล้ว</Badge>
              {s.voidReason && <div className="text-foreground">{s.voidReason}</div>}
              <div className="text-muted-foreground">
                โดย {s.voidedBy?.name ?? '-'} · {formatDateTime(s.deletedAt)}
              </div>
            </div>
          )}
        </div>
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
        const cfg = getStatusBadgeProps(s.saleType, saleTypeMap);
        return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
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
            <div className="text-xs text-destructive">ลด {Number(s.discount).toLocaleString()} ฿</div>
          )}
        </div>
      ),
    },
    // Profit column — OWNER only
    ...(isOwner ? [{
      key: 'profit',
      label: 'กำไร',
      render: (s: Sale) => {
        if (s.costPriceSnapshot == null) return <span className="text-xs text-muted-foreground">-</span>;
        const profit = saleMargin(s.netAmount, s.costPriceSnapshot)!;
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
          {s.tradeInCreditSnapshot && <div className="space-y-1 mt-1">
            <div>เงินสด/โอนสุทธิ {Number(s.tradeInCreditSnapshot.cashDownAmount).toLocaleString()} ฿</div>
            <div>เครดิตเครื่องเทิร์น {Number(s.tradeInCreditSnapshot.baseAmount).toLocaleString()} ฿</div>
            <div>โบนัส {Number(s.tradeInCreditSnapshot.bonusAmount).toLocaleString()} ฿ (รวมในส่วนลด)</div>
            <div className="text-muted-foreground">{s.tradeInCreditSnapshot.voucherNumber ?? s.tradeInCreditSnapshot.tradeInId}</div>
          </div>}
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
        const cfg = getStatusBadgeProps(s.contract.status, contractStatusMap);
        return (
          <div className="text-xs">
            <div className="font-mono text-primary">{s.contract.contractNumber}</div>
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>
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
    // Actions — OWNER/BRANCH_MANAGER only (API: @Roles('OWNER','BRANCH_MANAGER'))
    ...(isOwnerOrManager ? [{
      key: 'actions',
      label: '',
      render: (s: Sale) => {
        if (s.deletedAt) return null;
        if (!VOIDABLE_SALE_TYPES.has(s.saleType)) {
          return (
            <span className="text-2xs text-muted-foreground leading-snug" title="ใบขายผ่อนร้านยกเลิกผ่านหน้าสัญญา (ยกเลิกสัญญา) ไม่ใช่ที่นี่">
              ยกเลิกผ่านสัญญา
            </span>
          );
        }
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openVoidDialog(s); }}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors whitespace-nowrap"
          >
            <Ban className="w-3 h-3" />
            ยกเลิกใบขาย
          </button>
        );
      },
    }] : []),
  ].filter(column => ['saleNumber', 'createdAt', 'saleType', 'product', 'customer', 'netAmount', 'actions'].includes(column.key)), [navigate, searchParams, salesData?.page, limit, isOwner, isOwnerOrManager]);

  const inputClass = 'px-3 py-2 border border-input rounded-lg text-sm bg-background';

  return (
    <div>
      <PageHeader title="รายการขาย" subtitle="ยอดขายตามตัวกรอง แยกจากยอดเงินที่รับ" />

      {/* Summary Cards */}
      {summary && salesData && (
        <div className={`grid grid-cols-2 ${isOwner ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-5 mb-6`}>
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full">
              <div className="w-1 shrink-0 rounded-r-full bg-foreground/30" />
              <CardContent className="p-5 flex-1">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ทั้งหมด {salesData.total.toLocaleString()} รายการ</div>
                <div className="text-xl font-bold tabular-nums">{summary.totalAmount.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">฿</span></div>
                {summary.totalDiscount > 0 && <div className="text-xs text-destructive mt-1">ส่วนลดรวม {summary.totalDiscount.toLocaleString()} ฿</div>}
              </CardContent>
            </div>
          </Card>
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full">
              <div className="w-1 shrink-0 rounded-r-full bg-success" />
              <CardContent className="p-5 flex-1">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เงินสด</div>
                <div className="text-xl font-bold tabular-nums text-success">{summary.cashCount}</div>
                <div className="text-sm text-success mt-1 tabular-nums">{summary.cashAmount.toLocaleString()} ฿</div>
              </CardContent>
            </div>
          </Card>
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full">
              <div className="w-1 shrink-0 rounded-r-full bg-primary" />
              <CardContent className="p-5 flex-1">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ผ่อนร้าน</div>
                <div className="text-xl font-bold tabular-nums text-primary">{summary.installmentCount}</div>
                <div className="text-sm text-primary mt-1 tabular-nums">{summary.installmentAmount.toLocaleString()} ฿</div>
              </CardContent>
            </div>
          </Card>
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full">
              <div className="w-1 shrink-0 rounded-r-full bg-primary" />
              <CardContent className="p-5 flex-1">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ไฟแนนซ์</div>
                <div className="text-xl font-bold tabular-nums text-primary">{summary.financeCount}</div>
                <div className="text-sm text-primary mt-1 tabular-nums">{summary.financeAmount.toLocaleString()} ฿</div>
              </CardContent>
            </div>
          </Card>
          {isOwner && (
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
              <div className="flex h-full">
                <div className="w-1 shrink-0 rounded-r-full bg-warning" />
                <CardContent className="p-5 flex-1">
                  <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">กำไรรวม</div>
                  <div className={`text-xl font-bold tabular-nums ${summary.totalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {summary.totalProfit >= 0 ? '+' : ''}{summary.totalProfit.toLocaleString()} <span className="text-sm font-normal">฿</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">ยอดสุทธิ − ต้นทุนเครื่อง ณ วันขาย (เฉพาะรายการที่มีต้นทุน ไม่รวมของแถมและค่าธรรมเนียม)</p>
                  {!!summary.missingCostCount && <p className="text-xs text-muted-foreground mt-1">ไม่รวม {summary.missingCostCount.toLocaleString()} รายการที่ไม่มีต้นทุน ณ วันขาย</p>}
                </CardContent>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="bg-card rounded-xl border border-border/50 shadow-sm p-5 mb-6">
        {/* Row 1: Search + Type + Payment Method + Contract Status */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            type="text"
            aria-label="ค้นหารายการขาย" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="ค้นหาเลขที่ขาย, ลูกค้า, สินค้า, ไฟแนนซ์..."
            className={`${inputClass} md:col-span-1`}
          />
          <select
            aria-label="ประเภทการขาย" value={saleTypeFilter}
            onChange={(e) => setSaleTypeFilter(e.target.value)}
            className={inputClass}
          >
            <option value="">ทุกประเภท</option>
            <option value="CASH">เงินสด</option>
            <option value="INSTALLMENT">ผ่อนร้าน</option>
            <option value="EXTERNAL_FINANCE">ไฟแนนซ์</option>
          </select>
          <select
            aria-label="วิธีชำระ" value={paymentMethodFilter}
            onChange={(e) => setPaymentMethodFilter(e.target.value)}
            className={inputClass}
          >
            <option value="">ทุกวิธีชำระ</option>
            <option value="CASH">เงินสด</option>
            <option value="BANK_TRANSFER">โอนเงิน</option>
            <option value="QR_EWALLET">QR/E-Wallet</option>
          </select>
          <select
            aria-label="สถานะสัญญา" value={contractStatusFilter}
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
            aria-label="วันเริ่มต้น" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={`${inputClass} w-40`}
          />
          <span className="text-sm text-muted-foreground">ถึง</span>
          <ThaiDateInput
            aria-label="วันสิ้นสุด" value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={`${inputClass} w-40`}
          />
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setDateRange('today')} className="px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent transition-colors">วันนี้</button>
            <button onClick={() => setDateRange('week')} className="px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent transition-colors">สัปดาห์นี้</button>
            <button onClick={() => setDateRange('last_month')} className="px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent">เดือนก่อน</button>
            <button onClick={() => setDateRange('month')} className="px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent transition-colors">เดือนนี้</button>
          </div>
          <div className="ml-auto flex gap-2">
            {hasActiveFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-input hover:bg-accent transition-colors text-muted-foreground">
                <RotateCcw className="w-3.5 h-3.5" />
                ล้างตัวกรอง
              </button>
            )}
            <button onClick={exportExcel} disabled={isExporting || isError || isLoading} className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium">
              <Download className="w-3.5 h-3.5" />
              ส่งออก Excel
            </button>
          </div>
        </div>

        {/* Row 3: Salesperson + Branch (role-based) + show-voided switch */}
        {isOwnerOrManager && (
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="พนักงานขาย" value={salespersonFilter}
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
                aria-label="สาขา" value={branchFilter}
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

        {/* Row 4: show voided sales */}
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <SwitchWrapper className="gap-2">
            <Switch
              id="include-voided"
              size="sm"
              checked={includeVoided}
              onCheckedChange={(v) => setIncludeVoided(v === true)}
            />
            <Label htmlFor="include-voided" className="text-sm leading-snug cursor-pointer">
              แสดงใบที่ยกเลิกแล้ว
            </Label>
          </SwitchWrapper>
          {includeVoided && (
            <span className="text-xs text-warning leading-snug">
              ยอดสรุปรวมใบที่ยกเลิกแล้วด้วย — ปิดสวิตช์เพื่อดูยอดเฉพาะใบที่ใช้อยู่
            </span>
          )}
        </div>
      </div>

      {contractStatusFilter === 'DRAFT' && <p className="text-sm text-warning mb-4">รายการเตรียมสัญญา ยังไม่ใช่ยอดขายสำเร็จ</p>}
      {/* Sales Table */}
      <QueryBoundary
        isLoading={isLoading && !salesData}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดประวัติการขายได้"
      >
        <div ref={saleListRegion} tabIndex={-1} aria-label="รายการขาย">
        <DataTable
          columns={columns}
          data={salesData?.data || []}
          isLoading={isLoading}
          emptyMessage={hasActiveFilters ? 'ไม่พบรายการขายตามตัวกรอง' : 'ยังไม่มีรายการขาย'}
          onRowClick={(sale) => { saleOpenerId.current = null; openSale(sale.id); }}
          pagination={salesData ? {
            page: salesData.page,
            totalPages: salesData.totalPages,
            total: salesData.total,
            onPageChange: setPage,
          } : undefined}
        />
        </div>
      </QueryBoundary>

      <Sheet open={!!saleId} onOpenChange={open => { if (!open) setSearchParams(previous => {
        const next = new URLSearchParams(previous); next.delete('saleId'); return next;
      }); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" onCloseAutoFocus={event => {
          event.preventDefault();
          // Updating URL-driven columns can replace the original link node.
          const opener = Array.from(saleListRegion.current?.querySelectorAll<HTMLAnchorElement>('a[data-sale-id]') ?? [])
            .find(link => link.dataset.saleId === saleOpenerId.current);
          (opener ?? saleListRegion.current)?.focus();
        }}>
          <SheetHeader><SheetTitle>รายละเอียดใบขาย</SheetTitle><SheetDescription>ยอดขาย วิธีรับเงิน และเอกสารที่เกี่ยวข้อง</SheetDescription></SheetHeader>
          <QueryBoundary isLoading={saleDetail.isLoading} isError={saleDetail.isError} error={saleDetail.error} onRetry={saleDetail.refetch}>
            {saleDetail.data && <div className="space-y-5 text-sm">
              <div><p className="font-mono text-lg font-semibold">{saleDetail.data.saleNumber}</p><p className="text-muted-foreground">{formatThaiDateTime(saleDetail.data.createdAt, 'Asia/Bangkok')}</p>
                <Badge variant={saleDetail.data.deletedAt ? 'destructive' : 'success'}>{saleDetail.data.deletedAt ? 'ยกเลิกแล้ว' : saleDetail.data.contract?.status === 'DRAFT' ? 'เตรียมสัญญา' : 'ขายสำเร็จ'}</Badge></div>
              <div><Link className="text-primary underline" to={`/customers/${saleDetail.data.customer.id}`}>{saleDetail.data.customer.name}</Link><p>{saleDetail.data.product.name}</p><p className="font-mono text-xs text-muted-foreground">{saleDetail.data.product.imeiSerial || saleDetail.data.product.serialNumber}</p></div>
              <dl className="space-y-2 tabular-nums">
                {[
                  ['ราคาขาย', Number(saleDetail.data.sellingPrice)], ['ส่วนลด', Number(saleDetail.data.discount)], ['ยอดสุทธิ', Number(saleDetail.data.netAmount)],
                  ...(isOwner && saleDetail.data.costPriceSnapshot != null ? [['ต้นทุนเครื่อง ณ วันขาย', Number(saleDetail.data.costPriceSnapshot)], ['กำไรจากต้นทุน ณ วันขาย', saleMargin(saleDetail.data.netAmount, saleDetail.data.costPriceSnapshot)!]] : []),
                  ...(!saleDetail.data.receiptBreakdown && saleDetail.data.downPaymentAmount != null ? [['ดาวน์ที่ตกลง', Number(saleDetail.data.downPaymentAmount)]] : []),
                  ...(!saleDetail.data.receiptBreakdown ? [[saleDetail.data.saleType === 'CASH' ? 'รับก่อนทอน' : 'รับดาวน์', saleDetail.data.amountReceived == null ? null : Number(saleDetail.data.amountReceived)]] : []),
                  ...(saleDetail.data.financeAmount ? [['ยอดจัดไฟแนนซ์', Number(saleDetail.data.financeAmount)]] : []),
                ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd>{value == null ? 'ยังไม่ระบุ' : `${Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`}</dd></div>)}
              </dl>
              {isOwner && saleDetail.data.costPriceSnapshot == null && <p className="text-muted-foreground">ไม่ทราบต้นทุน ณ วันขาย จึงยังคำนวณกำไรไม่ได้</p>}
              {saleDetail.data.receiptBreakdown && <BookingSaleReceipt receipt={saleDetail.data.receiptBreakdown} />}
              <div>{!saleDetail.data.receiptBreakdown && <p>วิธีรับ: {paymentMethodLabels[saleDetail.data.paymentMethod] ?? 'ยังไม่ระบุ'}</p>}<p>พนักงาน: {saleDetail.data.salesperson.name}</p><p>สาขา: {saleDetail.data.branch.name}</p></div>
              {saleDetail.data.tradeInCreditSnapshot && <div className="rounded-lg border border-border p-3">
                <p>เงินสด/โอนสุทธิ {Number(saleDetail.data.tradeInCreditSnapshot.cashDownAmount).toLocaleString()} บาท</p>
                <p>เครดิตเทิร์น {Number(saleDetail.data.tradeInCreditSnapshot.baseAmount).toLocaleString()} บาท</p>
                <p>โบนัส {Number(saleDetail.data.tradeInCreditSnapshot.bonusAmount).toLocaleString()} บาท (รวมในส่วนลด)</p>
                <p>ใบรับเทิร์น: {saleDetail.data.tradeInCreditSnapshot.voucherNumber ?? saleDetail.data.tradeInCreditSnapshot.tradeInId}</p>
              </div>}
              {saleDetail.data.contract && <p className="tabular-nums">ค่างวด {Number(saleDetail.data.contract.monthlyPayment).toLocaleString()} บาท × {saleDetail.data.contract.totalMonths} งวด</p>}
              {saleDetail.data.contract && <Link className="inline-block text-primary underline" to={`/contracts/${saleDetail.data.contract.id}`}>เปิดสัญญา {saleDetail.data.contract.contractNumber}</Link>}
              {saleDetail.data.financeCompany && <p>ไฟแนนซ์: {saleDetail.data.financeCompany}<br />เลขอ้างอิง: {saleDetail.data.financeRefNumber || '-'}</p>}
              {saleDetail.data.notes && <p className="whitespace-pre-wrap break-words">หมายเหตุ: {saleDetail.data.notes}</p>}
              {saleDetail.data.deletedAt && <p className="text-destructive break-words">ยกเลิกเมื่อ {formatThaiDateTime(saleDetail.data.deletedAt, 'Asia/Bangkok')} โดย {saleDetail.data.voidedBy?.name ?? '-'}<br />เหตุผล: {saleDetail.data.voidReason}</p>}
            </div>}
          </QueryBoundary>
        </SheetContent>
      </Sheet>

      {/* Void sale dialog */}
      <ConfirmDialog
        open={!!voidTarget}
        onOpenChange={(open) => { if (!open && !voidMutation.isPending) setVoidTarget(null); }}
        title={`ยกเลิกใบขาย ${voidTarget?.saleNumber ?? ''}`}
        description="การยกเลิกทำย้อนกลับไม่ได้ — ระบบจะบันทึกเหตุผลและผู้ยกเลิกไว้ในใบขาย"
        confirmLabel="ยืนยันยกเลิกใบขาย"
        variant="destructive"
        loading={voidMutation.isPending}
        confirmDisabled={!voidReasonOk}
        closeOnConfirm={false}
        onConfirm={() => {
          if (!voidTarget) return;
          voidMutation.mutate({ id: voidTarget.id, reason: voidReason.trim() });
        }}
      >
        <div className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-xs leading-snug text-muted-foreground space-y-1">
            <div className="font-medium text-foreground">สิ่งที่จะเกิดขึ้น</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>สินค้าในใบ (รวมของแถม) กลับเข้าสต็อกพร้อมขาย</li>
              <li>กลับรายการบัญชีฝั่ง SHOP (รายได้/ต้นทุน) ของใบนี้</li>
              <li>เรียกคืนค่าคอมมิชชันของพนักงานขายจากใบนี้</li>
              <li>ถ้ามีร่างรอบจ่ายค่าคอม (สถานะร่าง) ที่รวมใบนี้ ร่างนั้นจะถูกลบ — กดสร้างรอบใหม่ที่หน้าค่าคอมเพื่อได้ยอดที่ถูกต้อง</li>
            </ul>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason" className="text-sm leading-snug">
              เหตุผลในการยกเลิก (อย่างน้อย {VOID_REASON_MIN} ตัวอักษร)
            </Label>
            <Textarea
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="เช่น คีย์ผิดรุ่นเครื่อง ลูกค้าไม่ได้ซื้อ"
              rows={3}
              disabled={voidMutation.isPending}
            />
            <div className="text-2xs text-muted-foreground leading-snug">
              {voidReason.trim().length}/{VOID_REASON_MIN} ตัวอักษร
            </div>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}

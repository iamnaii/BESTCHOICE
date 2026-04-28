import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import DataTable from '@/components/ui/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, receiptStatusMap } from '@/lib/status-badges';
import ReceiptVoidDialog from '@/components/payment/ReceiptVoidDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDebounce } from '@/hooks/useDebounce';
import { exportToExcel } from '@/utils/excel.util';
import { toast } from 'sonner';
import { formatDateShort } from '@/utils/formatters';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Download, MoreHorizontal, Send, XCircle } from 'lucide-react';

async function downloadReceiptPdf(receiptId: string, receiptNumber: string) {
  try {
    const res = await api.get(`/receipts/${receiptId}/pdf`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${receiptNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(getErrorMessage(err) || 'ไม่สามารถดาวน์โหลดใบเสร็จ');
  }
}

interface Receipt {
  id: string;
  receiptNumber: string;
  contractId: string;
  paymentId: string | null;
  receiptType: string;
  payerName: string;
  receiverName: string;
  amount: number;
  installmentNo: number | null;
  remainingBalance: number | null;
  remainingMonths: number | null;
  paymentMethod: string | null;
  transactionRef: string | null;
  paidDate: string;
  isVoided: boolean;
  voidReason: string | null;
  createdAt: string;
  contract?: { contractNumber: string; customer: { name: string } };
}

interface ReceiptsResponse {
  data: Receipt[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: { totalAmount: number; totalCount: number };
}

const receiptTypeLabels: Record<string, string> = {
  PAYMENT: 'งวดผ่อนชำระ',
  DOWN_PAYMENT: 'เงินดาวน์',
  EARLY_PAYOFF: 'ปิดก่อนกำหนด',
  CREDIT_NOTE: 'ใบลดหนี้',
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

export default function ReceiptsTab() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [receiptType, setReceiptType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [voidTarget, setVoidTarget] = useState<{ id: string; receiptNumber: string } | null>(null);

  const sendLineMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/receipts/${id}/send-line`);
      return data;
    },
    onSuccess: () => toast.success('ส่งใบเสร็จทาง LINE เรียบร้อยแล้ว'),
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [debouncedSearch, receiptType, dateFrom, dateTo]);

  const buildParams = (overrideLimit?: number) => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (receiptType) params.set('receiptType', receiptType);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    params.set('page', String(page));
    if (overrideLimit) params.set('limit', String(overrideLimit));
    return params;
  };

  const { data: result, isLoading, isError, error, refetch } = useQuery<ReceiptsResponse>({
    queryKey: ['receipts', debouncedSearch, receiptType, dateFrom, dateTo, page],
    queryFn: async () => {
      const { data } = await api.get(`/receipts?${buildParams()}`);
      return data;
    },
  });

  const receipts = result?.data || [];
  const summary = result?.summary;

  const columns = useMemo(() => [
    {
      key: 'receiptNumber',
      label: 'เลขใบเสร็จ',
      render: (r: Receipt) => <span className="font-mono text-xs">{r.receiptNumber}</span>,
    },
    {
      key: 'contractNumber',
      label: 'เลขสัญญา',
      render: (r: Receipt) => (
        <span className="font-mono text-xs text-primary">{r.contract?.contractNumber || '-'}</span>
      ),
    },
    {
      key: 'receiptType',
      label: 'ประเภท',
      render: (r: Receipt) => {
        const isCredit = r.receiptType === 'CREDIT_NOTE';
        return (
          <Badge variant={isCredit ? 'warning' : 'primary'} appearance="light" size="sm">
            {receiptTypeLabels[r.receiptType] || r.receiptType}
          </Badge>
        );
      },
    },
    {
      key: 'payerName',
      label: 'ผู้ชำระ',
      render: (r: Receipt) => <span className="text-sm">{r.payerName}</span>,
    },
    {
      key: 'amount',
      label: 'จำนวนเงิน',
      render: (r: Receipt) => (
        <span className="font-medium text-right block">{Number(r.amount).toLocaleString()} ฿</span>
      ),
    },
    {
      key: 'installmentNo',
      label: 'งวดที่',
      render: (r: Receipt) => <span className="text-center block">{r.installmentNo || '-'}</span>,
    },
    {
      key: 'paymentMethod',
      label: 'วิธีชำระ',
      render: (r: Receipt) => (
        <span className="text-xs">{r.paymentMethod ? methodLabels[r.paymentMethod] || r.paymentMethod : '-'}</span>
      ),
    },
    {
      key: 'paidDate',
      label: 'วันที่',
      render: (r: Receipt) => (
        <span className="text-xs">{formatDateShort(r.paidDate)}</span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (r: Receipt) => {
        const statusKey = r.isVoided ? 'REJECTED' : 'VERIFIED';
        const cfg = getStatusBadgeProps(statusKey, receiptStatusMap);
        return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{r.isVoided ? 'ยกเลิก' : 'ปกติ'}</Badge>;
      },
    },
    {
      key: 'actions',
      label: '',
      render: (r: Receipt) => (
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => downloadReceiptPdf(r.id, r.receiptNumber)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded transition-colors"
            title="ดาวน์โหลดใบเสร็จ PDF"
          >
            <Download className="h-3 w-3" />
            ใบเสร็จ
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                title="เพิ่มเติม"
                aria-label="เพิ่มเติม"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => sendLineMutation.mutate(r.id)}
                disabled={sendLineMutation.isPending || r.isVoided}
              >
                <Send className="h-4 w-4 mr-2" />
                ส่งใบเสร็จให้ลูกค้า
              </DropdownMenuItem>
              {!r.isVoided && r.receiptType !== 'CREDIT_NOTE' && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setVoidTarget({ id: r.id, receiptNumber: r.receiptNumber })}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  ยกเลิกใบเสร็จ
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], []);

  const exportExcel = async () => {
    try {
      toast.loading('กำลังสร้างไฟล์ Excel...', { id: 'excel-export' });
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (receiptType) params.set('receiptType', receiptType);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      params.set('limit', '10000');
      const { data: allData } = await api.get<ReceiptsResponse>(`/receipts?${params}`);

      const now = new Date();
      await exportToExcel({
        columns: [
          { header: 'เลขใบเสร็จ', key: 'receiptNumber', width: 22 },
          { header: 'เลขสัญญา', key: 'contractNumber', width: 18 },
          { header: 'ประเภท', key: 'receiptType', width: 16 },
          { header: 'ผู้ชำระ', key: 'payerName', width: 25 },
          { header: 'จำนวนเงิน', key: 'amount', width: 14 },
          { header: 'งวดที่', key: 'installmentNo', width: 8 },
          { header: 'วิธีชำระ', key: 'paymentMethod', width: 14 },
          { header: 'เลขอ้างอิง', key: 'transactionRef', width: 22 },
          { header: 'วันที่ชำระ', key: 'paidDate', width: 16 },
          { header: 'สถานะ', key: 'status', width: 10 },
        ],
        data: allData.data.map((r: Receipt) => ({
          receiptNumber: r.receiptNumber,
          contractNumber: r.contract?.contractNumber || '-',
          receiptType: receiptTypeLabels[r.receiptType] || r.receiptType,
          payerName: r.payerName,
          amount: Number(r.amount),
          installmentNo: r.installmentNo || '-',
          paymentMethod: r.paymentMethod ? methodLabels[r.paymentMethod] || r.paymentMethod : '-',
          transactionRef: r.transactionRef || '-',
          paidDate: formatDateShort(r.paidDate),
          status: r.isVoided ? 'ยกเลิก' : 'ปกติ',
        })),
        sheetName: 'ใบเสร็จ',
        filename: `ใบเสร็จ_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`,
      });
      toast.success(`ดาวน์โหลดสำเร็จ (${allData.data.length} รายการ)`, { id: 'excel-export' });
    } catch {
      toast.error('ไม่สามารถสร้างไฟล์ Excel ได้', { id: 'excel-export' });
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
          <div className="flex h-full">
            <div className="w-1 shrink-0 rounded-r-full bg-primary" />
            <CardContent className="p-5 flex-1">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนใบเสร็จ</div>
              <div className="text-2xl font-bold tabular-nums">{summary?.totalCount?.toLocaleString() || 0}</div>
            </CardContent>
          </div>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
          <div className="flex h-full">
            <div className="w-1 shrink-0 rounded-r-full bg-success" />
            <CardContent className="p-5 flex-1">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรวม</div>
              <div className="text-2xl font-bold tabular-nums text-success">
                {Number(summary?.totalAmount || 0).toLocaleString()} ฿
              </div>
            </CardContent>
          </div>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Export</div>
              <div className="text-sm text-muted-foreground">ดาวน์โหลดข้อมูลตามตัวกรอง</div>
            </div>
            <button
              onClick={exportExcel}
              disabled={!receipts.length}
              className="px-4 py-2 text-sm bg-success text-success-foreground rounded-lg hover:bg-success/90 disabled:opacity-50"
            >
              Excel
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="bg-card rounded-xl border border-border/50 shadow-sm p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาเลขสัญญา / ชื่อลูกค้า / เบอร์โทร / เลขใบเสร็จ..."
            className="px-3 py-2 border border-input rounded-lg text-sm md:col-span-1"
          />
          <select
            value={receiptType}
            onChange={(e) => setReceiptType(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          >
            <option value="">ทุกประเภท</option>
            <option value="PAYMENT">งวดผ่อนชำระ</option>
            <option value="DOWN_PAYMENT">เงินดาวน์</option>
            <option value="EARLY_PAYOFF">ปิดก่อนกำหนด</option>
            <option value="CREDIT_NOTE">ใบลดหนี้</option>
          </select>
          <ThaiDateInput
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
            placeholder="จากวันที่"
          />
          <ThaiDateInput
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
            placeholder="ถึงวันที่"
          />
        </div>
      </div>

      {/* Table */}
      <QueryBoundary
        isLoading={isLoading && !result}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดใบเสร็จได้"
      >
        <DataTable
          columns={columns}
          data={receipts}
          isLoading={isLoading}
          emptyMessage="ไม่พบใบเสร็จ"
          pagination={result ? {
            page: result.page,
            totalPages: result.totalPages,
            total: result.total,
            onPageChange: setPage,
          } : undefined}
        />
      </QueryBoundary>

      <ReceiptVoidDialog
        receiptId={voidTarget?.id ?? null}
        receiptNumber={voidTarget?.receiptNumber}
        onClose={() => setVoidTarget(null)}
      />
    </div>
  );
}

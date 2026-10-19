import { NativeSelect } from '@/components/ui/native-select';
import DocumentDownloadButton from '@/components/DocumentDownloadButton';
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import DataTable, { type Column } from '@/components/ui/DataTable';
import { Button, buttonVariants } from '@/components/ui/button';
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
import type { VoidedReceiptInfo } from '../types';
import { RECEIPT_METHOD_LABELS, RECEIPT_TYPE_LABELS } from '@/lib/receipt-labels';


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
  /** Auto-issued CN source (JP5 repossession / bad-debt write-off) — null/undefined for ordinary receipts. */
  cnSource?: string | null;
  /** Latest NotificationLog attempt for this CN's LINE delivery — undefined for non-CN rows, null when a CN has no attempt yet. */
  lastCnDelivery?: { status: string; createdAt: string } | null;
}

interface ReceiptsResponse {
  data: Receipt[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: { totalAmount: number; totalCount: number };
}

const receiptTypeLabels = RECEIPT_TYPE_LABELS;
const methodLabels = RECEIPT_METHOD_LABELS;

// Phase 3 Task 6 — CN แหล่งที่มา (JP5 repossession vs bad-debt write-off)
const cnSourceLabels: Record<string, string> = {
  REPOSSESSION: 'ยึดเครื่อง',
  WRITE_OFF: 'ตัดหนี้สูญ',
};

/** สถานะส่ง LINE ของ CN — จาก NotificationLog ล่าสุด (category='CREDIT_NOTE'). */
function cnDeliveryBadgeProps(
  lastCnDelivery: Receipt['lastCnDelivery'],
): { label: string; variant: 'success' | 'destructive' | 'secondary' } {
  if (!lastCnDelivery) return { label: 'ยังไม่ส่ง', variant: 'secondary' };
  if (lastCnDelivery.status === 'SENT') return { label: 'ส่งแล้ว', variant: 'success' };
  if (lastCnDelivery.status === 'FAILED') return { label: 'ส่งไม่สำเร็จ', variant: 'destructive' };
  return { label: 'ยังไม่ส่ง', variant: 'secondary' };
}

interface ReceiptsTabProps {
  /** Mockup §11.1 — called after a successful void so the parent can re-open
   *  the record wizard on the now-unpaid installment. */
  onVoided?: (info: VoidedReceiptInfo) => void;
}

export default function ReceiptsTab({ onVoided }: ReceiptsTabProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [receiptType, setReceiptType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [voidTarget, setVoidTarget] = useState<
    { id: string; receiptNumber: string; info: VoidedReceiptInfo } | null
  >(null);

  const sendLineMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/receipts/${id}/send-line`);
      return data;
    },
    onSuccess: () => {
      toast.success('ส่งใบเสร็จทาง LINE เรียบร้อยแล้ว');
      // Refresh so the CN "สถานะส่ง LINE" chip reflects the new delivery attempt.
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
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

  const columns = useMemo<Column<Receipt>[]>(() => [
    {
      key: 'receiptNumber', label: 'ใบเสร็จ / ประเภท', width: '13rem',
      cardFullWidth: true, className: '[overflow-wrap:anywhere]',
      render: (r: Receipt) => {
        const isCredit = r.receiptType === 'CREDIT_NOTE';
        const deliveryBadge = cnDeliveryBadgeProps(r.lastCnDelivery);
        return <div className="space-y-2">
          <div className="font-mono text-xs">{r.receiptNumber}</div>
          <div className="flex flex-wrap items-center gap-1">
            <Badge className="admin-status-badge" variant={isCredit ? 'warning' : 'primary'} appearance="light" size="sm">
              {receiptTypeLabels[r.receiptType] || r.receiptType}
            </Badge>
            {isCredit && r.cnSource && <>
              <Badge className="admin-status-badge" variant="secondary" appearance="light" size="sm">{cnSourceLabels[r.cnSource] || r.cnSource}</Badge>
              <Badge className="admin-status-badge" variant={deliveryBadge.variant} appearance="light" size="sm">{deliveryBadge.label}</Badge>
            </>}
          </div>
        </div>;
      },
    },
    {
      key: 'contractNumber', label: 'สัญญา / ผู้ชำระ', cardFullWidth: true,
      className: '[overflow-wrap:anywhere]',
      render: (r: Receipt) => <div className="space-y-1">
        <div className="font-mono text-xs text-primary">{r.contract?.contractNumber || '-'}</div>
        <div className="text-sm">{r.payerName}</div>
      </div>,
    },
    {
      key: 'amount', label: 'จำนวนเงิน', width: '11rem', align: 'right',
      className: 'tabular-nums',
      render: (r: Receipt) => <div className="space-y-1">
        <div className="whitespace-nowrap font-medium">{Number(r.amount).toLocaleString()} ฿</div>
        <div className="text-xs text-muted-foreground">งวดที่ {r.installmentNo || '-'}</div>
        <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.paymentMethod ? methodLabels[r.paymentMethod] || r.paymentMethod : '-'}</div>
      </div>,
    },
    {
      key: 'paidDate', label: 'วันที่ / สถานะ', width: '9rem',
      render: (r: Receipt) => {
        const cfg = getStatusBadgeProps(r.isVoided ? 'REJECTED' : 'VERIFIED', receiptStatusMap);
        return <div className="space-y-2">
          <div className="text-xs whitespace-nowrap tabular-nums">{formatDateShort(r.paidDate)}</div>
          <Badge className="admin-status-badge" variant={cfg.variant} appearance={cfg.appearance} size="sm">{r.isVoided ? 'ยกเลิก' : 'ปกติ'}</Badge>
        </div>;
      },
    },
    {
      key: 'actions',
      label: 'จัดการ',
      cardFullWidth: true,
      width: '11rem',
      align: 'right',
      sortable: false,
      render: (r: Receipt) => (
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <DocumentDownloadButton path={`/receipts/${r.id}/pdf`} filename={`${r.receiptNumber}.pdf`}
            className={buttonVariants({ variant: 'outline', size: 'md', className: 'min-h-0 max-lg:min-h-11' })}
            title="ดาวน์โหลดใบเสร็จ PDF"
          >
            <Download className="h-3 w-3" />
            ใบเสร็จ
          </DocumentDownloadButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title="เพิ่มเติม"
                aria-label="เพิ่มเติม"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
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
                  onClick={() =>
                    setVoidTarget({
                      id: r.id,
                      receiptNumber: r.receiptNumber,
                      info: {
                        paymentId: r.paymentId,
                        contractNumber: r.contract?.contractNumber,
                      },
                    })
                  }
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
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ส่งออก</div>
              <div className="text-sm text-muted-foreground">ดาวน์โหลดข้อมูลตามตัวกรอง</div>
            </div>
            <button data-ui-control="button"
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
          <input aria-label="ค้นหาเลขสัญญา / ชื่อลูกค้า / เบอร์โทร / เลขใบเสร็จ"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาเลขสัญญา / ชื่อลูกค้า / เบอร์โทร / เลขใบเสร็จ..."
            className="px-3 py-2 border border-input rounded-lg text-sm md:col-span-1"
          />
          <NativeSelect wrapperClassName="max-w-full w-auto" aria-label="ประเภทใบเสร็จ"
            value={receiptType}
            onChange={(e) => setReceiptType(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          >
            <option value="">ทุกประเภท</option>
            <option value="PAYMENT">งวดผ่อนชำระ</option>
            <option value="DOWN_PAYMENT">เงินดาวน์</option>
            <option value="EARLY_PAYOFF">ปิดก่อนกำหนด</option>
            <option value="CREDIT_NOTE">ใบลดหนี้</option>
            <option value="ADVANCE_SURPLUS">เงินรับล่วงหน้า (ลิงก์ชำระ)</option>
          </NativeSelect>
          <ThaiDateInput aria-label="วันที่เริ่ม"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
            placeholder="จากวันที่"
          />
          <ThaiDateInput aria-label="วันที่สิ้นสุด"
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
          density="compact"
          responsive
          scrollLabel="ตารางใบเสร็จ"
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
        onVoided={() => {
          if (voidTarget) onVoided?.(voidTarget.info);
        }}
      />
    </div>
  );
}

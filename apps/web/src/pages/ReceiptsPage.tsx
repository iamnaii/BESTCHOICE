import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import ReceiptModal from '@/components/payment/ReceiptModal';
import { useDebounce } from '@/hooks/useDebounce';
import { exportToExcel } from '@/utils/excel.util';
import { toast } from 'sonner';

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

function ReceiptsPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [receiptType, setReceiptType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);

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

  const { data: result, isLoading } = useQuery<ReceiptsResponse>({
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
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isCredit ? 'bg-warning/10 text-warning dark:bg-warning/15' : 'bg-blue-50 text-blue-700'}`}>
            {receiptTypeLabels[r.receiptType] || r.receiptType}
          </span>
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
        <span className="text-xs">{new Date(r.paidDate).toLocaleDateString('th-TH')}</span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (r: Receipt) => r.isVoided
        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive dark:bg-destructive/15">ยกเลิก</span>
        : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success dark:bg-success/15">ปกติ</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (r: Receipt) => (
        <button
          onClick={() => setSelectedReceiptId(r.id)}
          className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded"
        >
          ดูรายละเอียด
        </button>
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
          paidDate: new Date(r.paidDate).toLocaleDateString('th-TH'),
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
      <PageHeader
        title="ใบเสร็จรับเงิน (e-Receipt)"
        subtitle="ค้นหาและจัดการใบเสร็จรับเงินอิเล็กทรอนิกส์"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="border-l-[3px] border-l-primary hover:shadow-card-hover transition-all">
          <CardContent className="pt-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนใบเสร็จ</div>
            <div className="text-2xl font-bold">{summary?.totalCount?.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        <Card className="border-l-[3px] border-l-success hover:shadow-card-hover transition-all">
          <CardContent className="pt-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรวม</div>
            <div className="text-2xl font-bold text-success">
              {Number(summary?.totalAmount || 0).toLocaleString()} ฿
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-card-hover transition-all">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Export</div>
              <div className="text-sm text-muted-foreground">ดาวน์โหลดข้อมูลตามตัวกรอง</div>
            </div>
            <button
              onClick={exportExcel}
              disabled={!receipts.length}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              Excel
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="bg-card rounded-lg border border-border/60 p-4 mb-6">
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
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
            placeholder="จากวันที่"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
            placeholder="ถึงวันที่"
          />
        </div>
      </div>

      {/* Table */}
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

      {/* Receipt Detail Modal (with print + void) */}
      <ReceiptModal
        receiptId={selectedReceiptId}
        onClose={() => {
          setSelectedReceiptId(null);
          queryClient.invalidateQueries({ queryKey: ['receipts'] });
        }}
      />
    </div>
  );
}

export default ReceiptsPage;

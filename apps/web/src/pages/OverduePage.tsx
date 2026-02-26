import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import toast from 'react-hot-toast';

interface OverduePayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  lateFee: string;
  status: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
}

export default function OverduePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'OVERDUE' | 'all'>('OVERDUE');

  const { data: overduePayments = [], isLoading } = useQuery<OverduePayment[]>({
    queryKey: ['overdue-payments', filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      const { data } = await api.get(`/payments/pending?${params}`);
      return data;
    },
  });

  const runCronMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/cron/run-daily');
      return data;
    },
    onSuccess: (data) => {
      toast.success(`คำนวณค่าปรับเสร็จ: ${data.lateFees.updated} รายการ, สถานะ: ${data.statuses.overdueCount} OVERDUE, ${data.statuses.defaultCount} DEFAULT`);
      queryClient.invalidateQueries({ queryKey: ['overdue-payments'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  // Calculate summary stats (memoized to avoid recomputing on every render)
  const { totalLateFees, totalOutstanding, uniqueContracts } = useMemo(() => ({
    totalLateFees: overduePayments.reduce((sum, p) => sum + parseFloat(p.lateFee), 0),
    totalOutstanding: overduePayments.reduce((sum, p) => sum + (parseFloat(p.amountDue) - parseFloat(p.amountPaid)), 0),
    uniqueContracts: new Set(overduePayments.map((p) => p.contract.id)).size,
  }), [overduePayments]);

  const navigateToContract = useCallback((id: string) => navigate(`/contracts/${id}`), [navigate]);

  const columns = useMemo(() => [
    {
      key: 'contract',
      label: 'สัญญา',
      render: (p: OverduePayment) => (
        <button onClick={() => navigateToContract(p.contract.id)} className="text-left">
          <div className="font-mono text-sm text-primary-600 hover:underline">{p.contract.contractNumber}</div>
          <div className="text-xs text-gray-500">{p.contract.customer.name}</div>
        </button>
      ),
    },
    {
      key: 'customer',
      label: 'เบอร์โทร',
      render: (p: OverduePayment) => <span className="text-sm">{p.contract.customer.phone}</span>,
    },
    {
      key: 'installmentNo',
      label: 'งวดที่',
      render: (p: OverduePayment) => <span className="font-medium">{p.installmentNo}</span>,
    },
    {
      key: 'dueDate',
      label: 'วันครบกำหนด',
      render: (p: OverduePayment) => {
        const due = new Date(p.dueDate);
        const now = new Date();
        const daysLate = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        return (
          <div>
            <div className="text-sm">{due.toLocaleDateString('th-TH')}</div>
            <div className="text-xs text-red-600 font-medium">เกินกำหนด {daysLate} วัน</div>
          </div>
        );
      },
    },
    {
      key: 'amountDue',
      label: 'ยอดค้าง',
      render: (p: OverduePayment) => {
        const outstanding = parseFloat(p.amountDue) - parseFloat(p.amountPaid);
        return <span className="text-sm font-medium">{outstanding.toLocaleString()} ฿</span>;
      },
    },
    {
      key: 'lateFee',
      label: 'ค่าปรับ',
      render: (p: OverduePayment) => {
        const fee = parseFloat(p.lateFee);
        return fee > 0 ? (
          <span className="text-sm font-medium text-red-600">{fee.toLocaleString()} ฿</span>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        );
      },
    },
    {
      key: 'total',
      label: 'ยอดรวม',
      render: (p: OverduePayment) => {
        const total = parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid);
        return <span className="text-sm font-bold text-red-700">{total.toLocaleString()} ฿</span>;
      },
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (p: OverduePayment) => <span className="text-xs">{p.contract.branch.name}</span>,
    },
  ], [navigateToContract]);

  return (
    <div>
      <PageHeader
        title="ค่าปรับ & ค้างชำระ"
        subtitle="ระบบคำนวณค่าปรับล่าช้าและติดตามการค้างชำระ"
        action={
          <button
            onClick={() => runCronMutation.mutate()}
            disabled={runCronMutation.isPending}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {runCronMutation.isPending ? 'กำลังคำนวณ...' : 'คำนวณค่าปรับ'}
          </button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">สัญญาค้างชำระ</div>
          <div className="text-2xl font-bold text-red-600">{uniqueContracts}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">รายการค้างชำระ</div>
          <div className="text-2xl font-bold">{overduePayments.length}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ยอดค้างรวม</div>
          <div className="text-2xl font-bold">{totalOutstanding.toLocaleString()} ฿</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ค่าปรับรวม</div>
          <div className="text-2xl font-bold text-red-600">{totalLateFees.toLocaleString()} ฿</div>
        </div>
      </div>

      {/* Info box */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
        <div className="text-sm text-yellow-800">
          <strong>กฎค่าปรับ:</strong> 100 บาท/วัน สูงสุด 200 บาท/งวด |
          ค้าง &gt; 7 วัน → สถานะ OVERDUE |
          ค้าง 2 งวดติดต่อกัน → สถานะ DEFAULT
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'OVERDUE' | 'all')}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="OVERDUE">เฉพาะเกินกำหนด</option>
          <option value="all">ทั้งหมด</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : (
        <DataTable columns={columns} data={overduePayments} emptyMessage="ไม่มีรายการค้างชำระ" />
      )}
    </div>
  );
}

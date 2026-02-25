import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface Payment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  paidDate: string | null;
  paymentMethod: string | null;
  lateFee: number;
  status: string;
  notes: string | null;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
    product: { id: string; name: string; brand: string; model: string };
    branch: { id: string; name: string };
  };
  recordedBy: { id: string; name: string } | null;
}

const statusLabels: Record<string, string> = {
  PENDING: 'รอชำระ', PAID: 'ชำระแล้ว', PARTIALLY_PAID: 'ชำระบางส่วน', OVERDUE: 'เกินกำหนด',
};

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700', PAID: 'bg-green-100 text-green-700',
  PARTIALLY_PAID: 'bg-orange-100 text-orange-700', OVERDUE: 'bg-red-100 text-red-700',
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', QR_EWALLET: 'QR/E-Wallet',
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [payingPayment, setPayingPayment] = useState<Payment | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [payForm, setPayForm] = useState({ amountPaid: 0, paymentMethod: 'CASH', notes: '' });

  const { data: payments = [], isLoading } = useQuery<Payment[]>({
    queryKey: ['payments', statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      const { data } = await api.get(`/payments?${params}`);
      return data;
    },
  });

  const payMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof payForm }) => {
      return api.post(`/payments/${id}/pay`, {
        amountPaid: Number(data.amountPaid),
        paymentMethod: data.paymentMethod,
        notes: data.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      toast.success('บันทึกการชำระสำเร็จ');
      setPayingPayment(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const openPay = (p: Payment) => {
    setPayingPayment(p);
    setPayForm({ amountPaid: Number(p.amountDue), paymentMethod: 'CASH', notes: '' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (payingPayment) payMutation.mutate({ id: payingPayment.id, data: payForm });
  };

  const isOverdue = (dueDate: string) => new Date(dueDate) < new Date();

  // Summary stats
  const totalPending = payments.filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE').length;
  const totalPaid = payments.filter((p) => p.status === 'PAID').length;
  const totalOverdue = payments.filter((p) => p.status === 'PENDING' && isOverdue(p.dueDate)).length;

  const columns = [
    {
      key: 'contract', label: 'สัญญา / ลูกค้า',
      render: (p: Payment) => (
        <div>
          <div className="font-medium text-gray-900">{p.contract.contractNumber}</div>
          <div className="text-xs text-gray-500">{p.contract.customer.name} | {p.contract.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'product', label: 'สินค้า',
      render: (p: Payment) => <div className="text-sm">{p.contract.product.brand} {p.contract.product.model}</div>,
    },
    {
      key: 'installmentNo', label: 'งวดที่',
      render: (p: Payment) => <span className="font-medium">{p.installmentNo}</span>,
    },
    {
      key: 'dueDate', label: 'ครบกำหนด',
      render: (p: Payment) => {
        const d = new Date(p.dueDate);
        const overdue = p.status !== 'PAID' && isOverdue(p.dueDate);
        return (
          <span className={overdue ? 'text-red-600 font-medium' : ''}>
            {d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
          </span>
        );
      },
    },
    {
      key: 'amountDue', label: 'ยอดที่ต้องชำระ',
      render: (p: Payment) => Number(p.amountDue).toLocaleString('th-TH') + ' ฿',
    },
    {
      key: 'amountPaid', label: 'ชำระแล้ว',
      render: (p: Payment) => Number(p.amountPaid) > 0 ? (
        <div>
          <div>{Number(p.amountPaid).toLocaleString('th-TH')} ฿</div>
          {p.paymentMethod && <div className="text-xs text-gray-500">{methodLabels[p.paymentMethod] || p.paymentMethod}</div>}
        </div>
      ) : '-',
    },
    {
      key: 'status', label: 'สถานะ',
      render: (p: Payment) => {
        const displayStatus = p.status === 'PENDING' && isOverdue(p.dueDate) ? 'OVERDUE' : p.status;
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[displayStatus] || 'bg-gray-100 text-gray-700'}`}>
            {statusLabels[displayStatus] || displayStatus}
          </span>
        );
      },
    },
    {
      key: 'actions', label: '',
      render: (p: Payment) => p.status !== 'PAID' ? (
        <button onClick={() => openPay(p)} className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700">
          ชำระ
        </button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="ชำระเงิน" subtitle={`${totalPending} รอชำระ | ${totalPaid} ชำระแล้ว | ${totalOverdue} เกินกำหนด`} />

      <div className="flex gap-3 mb-4">
        <input type="text" placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-72 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none">
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <DataTable columns={columns} data={payments} isLoading={isLoading} />

      {/* Pay Modal */}
      <Modal isOpen={!!payingPayment} onClose={() => setPayingPayment(null)} title="บันทึกการชำระเงิน">
        {payingPayment && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div><span className="text-gray-500">สัญญา:</span> <span className="font-medium">{payingPayment.contract.contractNumber}</span></div>
              <div><span className="text-gray-500">ลูกค้า:</span> <span className="font-medium">{payingPayment.contract.customer.name}</span></div>
              <div><span className="text-gray-500">งวดที่:</span> <span className="font-medium">{payingPayment.installmentNo}</span></div>
              <div><span className="text-gray-500">ยอดที่ต้องชำระ:</span> <span className="font-semibold text-primary-700">{Number(payingPayment.amountDue).toLocaleString()} ฿</span></div>
              {isOverdue(payingPayment.dueDate) && (
                <div className="text-red-600 font-medium">เกินกำหนดชำระ</div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนเงินที่ชำระ *</label>
              <input type="number" value={payForm.amountPaid} onChange={(e) => setPayForm({ ...payForm, amountPaid: Number(e.target.value) })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วิธีชำระ *</label>
              <select value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                {Object.entries(methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <textarea value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setPayingPayment(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ยกเลิก</button>
              <button type="submit" disabled={payMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                {payMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันชำระเงิน'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

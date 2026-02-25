import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';

interface PendingPayment {
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

interface DailySummary {
  date: string;
  totalPayments: number;
  totalAmount: number;
  totalLateFees: number;
  byMethod: Record<string, number>;
  payments: any[];
}

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-gray-100 text-gray-700' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-red-100 text-red-700' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-yellow-100 text-yellow-700' },
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'summary'>('pending');
  const [statusFilter, setStatusFilter] = useState('');
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().split('T')[0]);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [payForm, setPayForm] = useState({ amount: 0, paymentMethod: 'CASH', notes: '' });

  // Pending payments
  const { data: pendingPayments = [], isLoading: loadingPending } = useQuery<PendingPayment[]>({
    queryKey: ['pending-payments', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/payments/pending?${params}`);
      return data;
    },
    enabled: tab === 'pending',
  });

  // Daily summary
  const { data: summary, isLoading: loadingSummary } = useQuery<DailySummary>({
    queryKey: ['daily-summary', summaryDate],
    queryFn: async () => {
      const { data } = await api.get(`/payments/daily-summary?date=${summaryDate}`);
      return data;
    },
    enabled: tab === 'summary',
  });

  const recordMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await api.post('/payments/record', body);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการชำระสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      setShowPayModal(false);
      setSelectedPayment(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const openPayModal = (payment: PendingPayment) => {
    setSelectedPayment(payment);
    const remaining = parseFloat(payment.amountDue) + parseFloat(payment.lateFee) - parseFloat(payment.amountPaid);
    setPayForm({ amount: Math.round(remaining), paymentMethod: 'CASH', notes: '' });
    setShowPayModal(true);
  };

  const handlePay = () => {
    if (!selectedPayment || payForm.amount <= 0) return;
    recordMutation.mutate({
      contractId: selectedPayment.contract.id,
      installmentNo: selectedPayment.installmentNo,
      amount: payForm.amount,
      paymentMethod: payForm.paymentMethod,
      notes: payForm.notes || undefined,
    });
  };

  const pendingColumns = [
    {
      key: 'contract',
      label: 'สัญญา',
      render: (p: PendingPayment) => (
        <div>
          <div className="font-mono text-sm text-primary-600">{p.contract.contractNumber}</div>
          <div className="text-xs text-gray-500">{p.contract.customer.name}</div>
        </div>
      ),
    },
    { key: 'installmentNo', label: 'งวดที่', render: (p: PendingPayment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: PendingPayment) => {
      const isOverdue = new Date(p.dueDate) < new Date();
      return <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : ''}`}>{new Date(p.dueDate).toLocaleDateString('th-TH')}</span>;
    }},
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: PendingPayment) => {
      const total = parseFloat(p.amountDue) + parseFloat(p.lateFee);
      return <span className="text-sm font-medium">{total.toLocaleString()} ฿</span>;
    }},
    { key: 'amountPaid', label: 'ชำระแล้ว', render: (p: PendingPayment) => {
      const paid = parseFloat(p.amountPaid);
      return paid > 0 ? <span className="text-sm text-green-600">{paid.toLocaleString()} ฿</span> : <span className="text-xs text-gray-400">-</span>;
    }},
    { key: 'lateFee', label: 'ค่าปรับ', render: (p: PendingPayment) => {
      const fee = parseFloat(p.lateFee);
      return fee > 0 ? <span className="text-sm text-red-600">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-gray-400">-</span>;
    }},
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: PendingPayment) => {
        const s = paymentStatusLabels[p.status] || { label: p.status, className: 'bg-gray-100' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    { key: 'branch', label: 'สาขา', render: (p: PendingPayment) => <span className="text-xs">{p.contract.branch.name}</span> },
    {
      key: 'actions',
      label: '',
      render: (p: PendingPayment) => (
        <button onClick={() => openPayModal(p)} className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
          รับชำระ
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="ชำระเงิน" subtitle="บันทึกการรับชำระค่างวด" />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => setTab('pending')} className={`px-4 py-2 text-sm rounded-md ${tab === 'pending' ? 'bg-white shadow font-medium' : 'text-gray-600'}`}>
          รายการรอชำระ
        </button>
        <button onClick={() => setTab('summary')} className={`px-4 py-2 text-sm rounded-md ${tab === 'summary' ? 'bg-white shadow font-medium' : 'text-gray-600'}`}>
          สรุปรายวัน
        </button>
      </div>

      {/* Pending Tab */}
      {tab === 'pending' && (
        <div>
          <div className="flex gap-3 mb-4">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">ทุกสถานะ</option>
              <option value="PENDING">รอชำระ</option>
              <option value="OVERDUE">เกินกำหนด</option>
              <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
            </select>
          </div>

          {loadingPending ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
          ) : (
            <DataTable columns={pendingColumns} data={pendingPayments} emptyMessage="ไม่มีรายการรอชำระ" />
          )}
        </div>
      )}

      {/* Summary Tab */}
      {tab === 'summary' && (
        <div>
          <div className="mb-4">
            <input
              type="date"
              value={summaryDate}
              onChange={(e) => setSummaryDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          {loadingSummary ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
          ) : summary ? (
            <div>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg border p-4">
                  <div className="text-xs text-gray-500 mb-1">จำนวนรายการ</div>
                  <div className="text-2xl font-bold">{summary.totalPayments}</div>
                </div>
                <div className="bg-white rounded-lg border p-4">
                  <div className="text-xs text-gray-500 mb-1">ยอดรวม</div>
                  <div className="text-2xl font-bold text-green-600">{summary.totalAmount.toLocaleString()} ฿</div>
                </div>
                <div className="bg-white rounded-lg border p-4">
                  <div className="text-xs text-gray-500 mb-1">ค่าปรับรวม</div>
                  <div className="text-2xl font-bold text-red-600">{summary.totalLateFees.toLocaleString()} ฿</div>
                </div>
                <div className="bg-white rounded-lg border p-4">
                  <div className="text-xs text-gray-500 mb-1">แยกตามวิธี</div>
                  {Object.entries(summary.byMethod).map(([method, amount]) => (
                    <div key={method} className="flex justify-between text-sm">
                      <span className="text-gray-600">{methodLabels[method] || method}</span>
                      <span className="font-medium">{amount.toLocaleString()} ฿</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment List */}
              {summary.payments.length > 0 && (
                <div className="bg-white rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3">สัญญา</th>
                        <th className="text-left p-3">ลูกค้า</th>
                        <th className="text-left p-3">งวดที่</th>
                        <th className="text-right p-3">ยอดชำระ</th>
                        <th className="text-left p-3">วิธี</th>
                        <th className="text-left p-3">เวลา</th>
                        <th className="text-left p-3">ผู้บันทึก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.payments.map((p: any) => (
                        <tr key={p.id} className="border-t">
                          <td className="p-3 font-mono text-xs">{p.contract?.contractNumber}</td>
                          <td className="p-3 text-xs">{p.contract?.customer?.name}</td>
                          <td className="p-3">{p.installmentNo}</td>
                          <td className="p-3 text-right font-medium">{Number(p.amountPaid).toLocaleString()} ฿</td>
                          <td className="p-3 text-xs">{methodLabels[p.paymentMethod] || p.paymentMethod}</td>
                          <td className="p-3 text-xs">{p.paidDate ? new Date(p.paidDate).toLocaleTimeString('th-TH') : '-'}</td>
                          <td className="p-3 text-xs">{p.recordedBy?.name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayModal && selectedPayment && (
        <Modal title="บันทึกการรับชำระ" onClose={() => { setShowPayModal(false); setSelectedPayment(null); }}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm"><span className="text-gray-500">สัญญา: </span><span className="font-mono font-medium">{selectedPayment.contract.contractNumber}</span></div>
              <div className="text-sm"><span className="text-gray-500">ลูกค้า: </span>{selectedPayment.contract.customer.name}</div>
              <div className="text-sm"><span className="text-gray-500">งวดที่: </span>{selectedPayment.installmentNo}</div>
              <div className="text-sm mt-2">
                <span className="text-gray-500">ยอดคงค้าง: </span>
                <span className="font-bold text-lg">{(parseFloat(selectedPayment.amountDue) + parseFloat(selectedPayment.lateFee) - parseFloat(selectedPayment.amountPaid)).toLocaleString()} ฿</span>
              </div>
              {parseFloat(selectedPayment.lateFee) > 0 && (
                <div className="text-xs text-red-600 mt-1">รวมค่าปรับ {parseFloat(selectedPayment.lateFee).toLocaleString()} ฿</div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนเงินที่รับ</label>
              <input
                type="number"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                min={0}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วิธีชำระ</label>
              <select value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนเงิน</option>
                <option value="QR_EWALLET">QR/E-Wallet</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <input
                type="text"
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowPayModal(false); setSelectedPayment(null); }} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button onClick={handlePay} disabled={recordMutation.isPending || payForm.amount <= 0} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {recordMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันรับชำระ'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

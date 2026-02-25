import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface OverdueContract {
  id: string;
  contractNumber: string;
  status: string;
  sellingPrice: string;
  financedAmount: string;
  monthlyPayment: string;
  customer: { id: string; name: string; phone: string; lineId: string | null };
  product: { id: string; name: string; brand: string; model: string; imeiSerial: string | null };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  payments: Array<{
    id: string;
    installmentNo: number;
    dueDate: string;
    amountDue: string;
    amountPaid: string;
    lateFee: string;
    status: string;
  }>;
  callLogs: Array<{
    id: string;
    calledAt: string;
    result: string;
    notes: string | null;
    caller: { id: string; name: string };
  }>;
}

interface OverdueSummary {
  overdueCount: number;
  defaultCount: number;
  totalOverdueAmount: number;
  totalLateFees: number;
}

const statusColors: Record<string, string> = {
  OVERDUE: 'bg-yellow-100 text-yellow-700',
  DEFAULT: 'bg-red-100 text-red-700',
};

const resultLabels: Record<string, string> = {
  ANSWERED: 'รับสาย',
  NO_ANSWER: 'ไม่รับสาย',
  PROMISED: 'สัญญาจะจ่าย',
  REFUSED: 'ปฏิเสธ',
};

interface PaginatedResponse {
  data: OverdueContract[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function OverduePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedContract, setSelectedContract] = useState<OverdueContract | null>(null);
  const [isCallLogModalOpen, setIsCallLogModalOpen] = useState(false);
  const [callLogForm, setCallLogForm] = useState({
    result: 'ANSWERED',
    notes: '',
  });

  const { data: summary } = useQuery<OverdueSummary>({
    queryKey: ['overdue-summary'],
    queryFn: async () => (await api.get('/overdue/summary')).data,
  });

  const { data: paginatedData, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['overdue', search, statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '50');
      return (await api.get(`/overdue?${params}`)).data;
    },
  });

  const contracts = paginatedData?.data || [];
  const totalPages = paginatedData?.totalPages || 1;
  const total = paginatedData?.total || 0;

  const createCallLogMutation = useMutation({
    mutationFn: async (data: { contractId: string; result: string; notes: string }) =>
      api.post('/overdue/call-logs', {
        ...data,
        calledAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['overdue'] });
      toast.success('บันทึก call log สำเร็จ');
      setIsCallLogModalOpen(false);
      setCallLogForm({ result: 'ANSWERED', notes: '' });
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  const openCallLogModal = (contract: OverdueContract) => {
    setSelectedContract(contract);
    setIsCallLogModalOpen(true);
  };

  const handleCallLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContract) return;
    createCallLogMutation.mutate({
      contractId: selectedContract.id,
      result: callLogForm.result,
      notes: callLogForm.notes,
    });
  };

  const columns = [
    {
      key: 'contractNumber',
      label: 'เลขสัญญา',
      render: (c: OverdueContract) => (
        <span className="font-medium text-primary-600">{c.contractNumber}</span>
      ),
    },
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (c: OverdueContract) => (
        <div>
          <div className="font-medium">{c.customer.name}</div>
          <div className="text-xs text-gray-500">{c.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (c: OverdueContract) => (
        <div className="text-xs">
          {c.product.brand} {c.product.model}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (c: OverdueContract) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[c.status] || ''}`}>
          {c.status === 'OVERDUE' ? 'ค้างชำระ' : 'ผิดนัด'}
        </span>
      ),
    },
    {
      key: 'overduePayments',
      label: 'งวดค้าง',
      render: (c: OverdueContract) => {
        const overduePayments = c.payments.filter((p) => ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status));
        const totalOutstanding = overduePayments.reduce(
          (sum, p) => sum + Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee),
          0,
        );
        return (
          <div>
            <div className="text-sm font-medium text-red-600">
              {overduePayments.length} งวด
            </div>
            <div className="text-xs text-gray-500">
              {totalOutstanding.toLocaleString()} บาท
            </div>
          </div>
        );
      },
    },
    {
      key: 'lastCall',
      label: 'ติดตามล่าสุด',
      render: (c: OverdueContract) => {
        const lastCall = c.callLogs[0];
        if (!lastCall) return <span className="text-xs text-gray-400">ยังไม่มี</span>;
        return (
          <div className="text-xs">
            <div>{new Date(lastCall.calledAt).toLocaleDateString('th-TH')}</div>
            <div className="text-gray-500">{resultLabels[lastCall.result] || lastCall.result}</div>
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (c: OverdueContract) => (
        <div className="flex gap-2">
          <button
            onClick={() => openCallLogModal(c)}
            className="text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            บันทึกการโทร
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="ติดตามหนี้" subtitle="รายการสัญญาค้างชำระและผิดนัด" />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">สัญญาค้างชำระ</div>
            <div className="text-2xl font-bold text-yellow-600">{summary.overdueCount}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">สัญญาผิดนัด</div>
            <div className="text-2xl font-bold text-red-600">{summary.defaultCount}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ยอมค้างชำระรวม</div>
            <div className="text-2xl font-bold text-gray-900">
              {summary.totalOverdueAmount.toLocaleString()} <span className="text-sm font-normal">บาท</span>
            </div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ค่าปรับรวม</div>
            <div className="text-2xl font-bold text-orange-600">
              {summary.totalLateFees.toLocaleString()} <span className="text-sm font-normal">บาท</span>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหา เลขสัญญา / ชื่อ / เบอร์โทร..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
        >
          <option value="">ทุกสถานะ</option>
          <option value="OVERDUE">ค้างชำระ</option>
          <option value="DEFAULT">ผิดนัด</option>
        </select>
      </div>

      <DataTable columns={columns} data={contracts} isLoading={isLoading} emptyMessage="ไม่มีสัญญาค้างชำระ" />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">
            ทั้งหมด {total} รายการ (หน้า {page}/{totalPages})
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              ก่อนหน้า
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              ถัดไป
            </button>
          </div>
        </div>
      )}

      {/* Call Log Modal */}
      <Modal
        isOpen={isCallLogModalOpen}
        onClose={() => setIsCallLogModalOpen(false)}
        title={`บันทึกการโทร - ${selectedContract?.contractNumber || ''}`}
      >
        {selectedContract && (
          <div>
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
              <div><strong>ลูกค้า:</strong> {selectedContract.customer.name}</div>
              <div><strong>เบอร์โทร:</strong> {selectedContract.customer.phone}</div>
              {selectedContract.customer.lineId && (
                <div><strong>LINE:</strong> {selectedContract.customer.lineId}</div>
              )}
            </div>

            {/* Recent Call Logs */}
            {selectedContract.callLogs.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">ประวัติการโทรล่าสุด</h4>
                <div className="space-y-2">
                  {selectedContract.callLogs.map((log) => (
                    <div key={log.id} className="text-xs bg-gray-50 rounded p-2">
                      <div className="flex justify-between">
                        <span className="font-medium">{resultLabels[log.result] || log.result}</span>
                        <span className="text-gray-400">
                          {new Date(log.calledAt).toLocaleString('th-TH')}
                        </span>
                      </div>
                      {log.notes && <div className="text-gray-600 mt-1">{log.notes}</div>}
                      <div className="text-gray-400">โดย: {log.caller.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleCallLogSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ผลการโทร *</label>
                <select
                  value={callLogForm.result}
                  onChange={(e) => setCallLogForm({ ...callLogForm, result: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                >
                  <option value="ANSWERED">รับสาย</option>
                  <option value="NO_ANSWER">ไม่รับสาย</option>
                  <option value="PROMISED">สัญญาจะจ่าย</option>
                  <option value="REFUSED">ปฏิเสธ</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
                <textarea
                  value={callLogForm.notes}
                  onChange={(e) => setCallLogForm({ ...callLogForm, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  placeholder="บันทึกรายละเอียดการสนทนา..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCallLogModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={createCallLogMutation.isPending}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                >
                  {createCallLogMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        )}
      </Modal>
    </div>
  );
}

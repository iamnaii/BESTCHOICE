import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Landmark, Plus, Eye, Receipt, Search } from 'lucide-react';

interface FinanceCompanyRef {
  name: string;
  shortName: string | null;
}

interface BranchRef {
  name: string;
}

interface FinanceReceivable {
  id: string;
  referenceNumber: string;
  financeCompanyId: string;
  financeCompany: FinanceCompanyRef;
  branch: BranchRef;
  contract: { contractNumber: string } | null;
  expectedAmount: string;
  receivedAmount: string;
  outstandingAmount: string;
  status: string;
  dueDate: string | null;
  notes: string | null;
  createdBy: { name: string };
  createdAt: string;
  receipts?: FinanceReceipt[];
}

interface FinanceReceipt {
  id: string;
  amount: string;
  paymentDate: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  recordedBy: { name: string };
  createdAt: string;
}

interface Summary {
  totalOutstanding: string;
  monthlyReceived: string;
  pendingCount: number;
  overdueCount: number;
}

interface FinanceCompanyOption {
  id: string;
  name: string;
  shortName: string | null;
}

interface BranchOption {
  id: string;
  name: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอรับ', className: 'bg-yellow-100 text-yellow-800' },
  PARTIALLY_PAID: { label: 'รับบางส่วน', className: 'bg-blue-100 text-blue-800' },
  FULLY_PAID: { label: 'รับครบ', className: 'bg-green-100 text-green-800' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-red-100 text-red-800' },
  CANCELLED: { label: 'ยกเลิก', className: 'bg-gray-100 text-gray-800' },
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  QR_EWALLET: 'QR/E-Wallet',
  CREDIT_BALANCE: 'เครดิต',
  ONLINE_GATEWAY: 'ออนไลน์',
};

const formatCurrency = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null) return '0.00';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 }).format(Number(value));
};

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const emptyCreateForm = {
  financeCompanyId: '',
  branchId: '',
  contractId: '',
  expectedAmount: '',
  dueDate: '',
  notes: '',
};

const emptyReceiptForm = {
  amount: '',
  paymentDate: new Date().toISOString().split('T')[0],
  paymentMethod: 'BANK_TRANSFER',
  referenceNumber: '',
  notes: '',
};

export default function FinanceReceivablesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedReceivable, setSelectedReceivable] = useState<FinanceReceivable | null>(null);

  // Forms
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [receiptForm, setReceiptForm] = useState(emptyReceiptForm);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, companyFilter]);

  // --- Queries ---

  const { data: summary } = useQuery<Summary>({
    queryKey: ['finance-receivables', 'summary'],
    queryFn: async () => {
      const { data } = await api.get('/finance-receivables/summary');
      return data;
    },
  });

  const { data: result, isLoading } = useQuery<{
    data: FinanceReceivable[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ['finance-receivables', debouncedSearch, statusFilter, companyFilter, page],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page) };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (companyFilter) params.financeCompanyId = companyFilter;
      const { data } = await api.get('/finance-receivables', { params });
      return data;
    },
  });

  const receivables = result?.data ?? [];
  const totalPages = result?.totalPages ?? 1;

  const { data: companiesResult } = useQuery<{ data: FinanceCompanyOption[] }>({
    queryKey: ['finance-receivables', 'companies'],
    queryFn: async () => {
      const { data } = await api.get('/finance-receivables/companies', {
        params: { limit: '100' },
      });
      return data;
    },
  });

  const companies = companiesResult?.data ?? [];

  const { data: branchesResult } = useQuery<{ data: BranchOption[] }>({
    queryKey: ['branches-list'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
    enabled: showCreateModal,
  });

  const branches = branchesResult?.data ?? [];

  const { data: detailData, isLoading: isDetailLoading } = useQuery<FinanceReceivable>({
    queryKey: ['finance-receivables', selectedReceivable?.id],
    queryFn: async () => {
      const { data } = await api.get(`/finance-receivables/${selectedReceivable!.id}`);
      return data;
    },
    enabled: showDetailModal && !!selectedReceivable?.id,
  });

  // --- Mutations ---

  const createMutation = useMutation({
    mutationFn: async (payload: typeof emptyCreateForm) => {
      return api.post('/finance-receivables', {
        financeCompanyId: payload.financeCompanyId,
        branchId: payload.branchId,
        contractId: payload.contractId || undefined,
        expectedAmount: Number(payload.expectedAmount),
        dueDate: payload.dueDate || undefined,
        notes: payload.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-receivables'] });
      toast.success('สร้างรายการตัดจ่ายสำเร็จ');
      setShowCreateModal(false);
      setCreateForm(emptyCreateForm);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const receiptMutation = useMutation({
    mutationFn: async ({
      receivableId,
      payload,
    }: {
      receivableId: string;
      payload: typeof emptyReceiptForm;
    }) => {
      return api.post(`/finance-receivables/${receivableId}/receipts`, {
        amount: Number(payload.amount),
        paymentDate: payload.paymentDate,
        paymentMethod: payload.paymentMethod || undefined,
        referenceNumber: payload.referenceNumber || undefined,
        notes: payload.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-receivables'] });
      toast.success('บันทึกรับเงินสำเร็จ');
      setShowReceiptModal(false);
      setReceiptForm(emptyReceiptForm);
      setSelectedReceivable(null);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  // --- Handlers ---

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(createForm);
  };

  const handleReceiptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReceivable) return;
    receiptMutation.mutate({ receivableId: selectedReceivable.id, payload: receiptForm });
  };

  const openDetail = (receivable: FinanceReceivable) => {
    setSelectedReceivable(receivable);
    setShowDetailModal(true);
  };

  const openReceipt = (receivable: FinanceReceivable) => {
    setSelectedReceivable(receivable);
    setReceiptForm(emptyReceiptForm);
    setShowReceiptModal(true);
  };

  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setShowCreateModal(true);
  };

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="ตัดจ่ายไฟแนนซ์"
        subtitle="ติดตามยอดรับจากบริษัทไฟแนนซ์"
      />

      {/* Section 1: Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">ยอดค้างรับรวม</p>
          <p className="text-2xl font-bold text-orange-600">
            ฿{formatCurrency(summary?.totalOutstanding)}
          </p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">รับเงินเดือนนี้</p>
          <p className="text-2xl font-bold text-green-600">
            ฿{formatCurrency(summary?.monthlyReceived)}
          </p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">รอรับ</p>
          <p className="text-2xl font-bold text-blue-600">{summary?.pendingCount ?? 0} รายการ</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">เกินกำหนด</p>
          <p className="text-2xl font-bold text-red-600">{summary?.overdueCount ?? 0} รายการ</p>
        </div>
      </div>

      {/* Section 2: Filters + Add Button */}
      <div className="bg-white rounded-lg border p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
          <div className="flex flex-col md:flex-row gap-3 flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="ค้นหาเลขที่อ้างอิง..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 pr-4 py-2 border rounded-lg text-sm w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">ทั้งหมด</option>
              <option value="PENDING">รอรับ</option>
              <option value="PARTIALLY_PAID">รับบางส่วน</option>
              <option value="FULLY_PAID">รับครบ</option>
              <option value="OVERDUE">เกินกำหนด</option>
            </select>
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">ทุกบริษัท</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shortName || c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            เพิ่มรายการ
          </button>
        </div>
      </div>

      {/* Section 3: Data Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 font-medium text-gray-600">เลขที่อ้างอิง</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">บริษัทไฟแนนซ์</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">สาขา</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">ยอดที่คาด</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">ยอดรับแล้ว</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">ยอดค้าง</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">สถานะ</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">กำหนดรับ</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-500">
                    กำลังโหลด...
                  </td>
                </tr>
              ) : receivables.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-500">
                    ไม่พบข้อมูล
                  </td>
                </tr>
              ) : (
                receivables.map((r) => {
                  const status = statusConfig[r.status] ?? {
                    label: r.status,
                    className: 'bg-gray-100 text-gray-800',
                  };
                  return (
                    <tr key={r.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{r.referenceNumber}</td>
                      <td className="px-4 py-3">
                        {r.financeCompany?.shortName || r.financeCompany?.name}
                      </td>
                      <td className="px-4 py-3">{r.branch?.name}</td>
                      <td className="px-4 py-3 text-right">฿{formatCurrency(r.expectedAmount)}</td>
                      <td className="px-4 py-3 text-right text-green-600">
                        ฿{formatCurrency(r.receivedAmount)}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-600">
                        ฿{formatCurrency(r.outstandingAmount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">{formatDate(r.dueDate)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openDetail(r)}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="ดูรายละเอียด"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {r.status !== 'FULLY_PAID' && r.status !== 'CANCELLED' && (
                            <button
                              onClick={() => openReceipt(r)}
                              className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded"
                              title="บันทึกรับเงิน"
                            >
                              <Receipt className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-sm text-gray-500">
              หน้า {page} จาก {totalPages} (ทั้งหมด {result?.total ?? 0} รายการ)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50 hover:bg-gray-50"
              >
                ก่อนหน้า
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50 hover:bg-gray-50"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 4a: Create Receivable Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">เพิ่มรายการตัดจ่ายไฟแนนซ์</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  บริษัทไฟแนนซ์ <span className="text-red-500">*</span>
                </label>
                <select
                  value={createForm.financeCompanyId}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, financeCompanyId: e.target.value })
                  }
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- เลือกบริษัท --</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shortName || c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  สาขา <span className="text-red-500">*</span>
                </label>
                <select
                  value={createForm.branchId}
                  onChange={(e) => setCreateForm({ ...createForm, branchId: e.target.value })}
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- เลือกสาขา --</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  เลขสัญญา (ถ้ามี)
                </label>
                <input
                  type="text"
                  value={createForm.contractId}
                  onChange={(e) => setCreateForm({ ...createForm, contractId: e.target.value })}
                  placeholder="เลขสัญญาที่เกี่ยวข้อง"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ยอดที่คาดว่าจะได้รับ <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={createForm.expectedAmount}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, expectedAmount: e.target.value })
                  }
                  required
                  placeholder="0.00"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">กำหนดรับ</label>
                <input
                  type="date"
                  value={createForm.dueDate}
                  onChange={(e) => setCreateForm({ ...createForm, dueDate: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
                <textarea
                  value={createForm.notes}
                  onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                  rows={3}
                  placeholder="หมายเหตุเพิ่มเติม"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Section 4b: Record Receipt Modal */}
      {showReceiptModal && selectedReceivable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">บันทึกรับเงิน</h2>
              <button
                onClick={() => {
                  setShowReceiptModal(false);
                  setSelectedReceivable(null);
                }}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                &times;
              </button>
            </div>
            <div className="px-4 pt-4 pb-2 bg-gray-50 border-b">
              <p className="text-sm text-gray-600">
                อ้างอิง: <span className="font-medium">{selectedReceivable.referenceNumber}</span>
              </p>
              <p className="text-sm text-gray-600">
                ยอดค้าง:{' '}
                <span className="font-medium text-orange-600">
                  ฿{formatCurrency(selectedReceivable.outstandingAmount)}
                </span>
              </p>
            </div>
            <form onSubmit={handleReceiptSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  จำนวนเงิน <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={receiptForm.amount}
                  onChange={(e) => setReceiptForm({ ...receiptForm, amount: e.target.value })}
                  required
                  placeholder="0.00"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  วันที่รับเงิน <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={receiptForm.paymentDate}
                  onChange={(e) =>
                    setReceiptForm({ ...receiptForm, paymentDate: e.target.value })
                  }
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  วิธีชำระเงิน
                </label>
                <select
                  value={receiptForm.paymentMethod}
                  onChange={(e) =>
                    setReceiptForm({ ...receiptForm, paymentMethod: e.target.value })
                  }
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="CASH">เงินสด</option>
                  <option value="BANK_TRANSFER">โอนธนาคาร</option>
                  <option value="QR_EWALLET">QR/E-Wallet</option>
                  <option value="CREDIT_BALANCE">เครดิต</option>
                  <option value="ONLINE_GATEWAY">ออนไลน์</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  เลขอ้างอิงการชำระ
                </label>
                <input
                  type="text"
                  value={receiptForm.referenceNumber}
                  onChange={(e) =>
                    setReceiptForm({ ...receiptForm, referenceNumber: e.target.value })
                  }
                  placeholder="เลขอ้างอิง / เลขที่สลิป"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
                <textarea
                  value={receiptForm.notes}
                  onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })}
                  rows={2}
                  placeholder="หมายเหตุเพิ่มเติม"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowReceiptModal(false);
                    setSelectedReceivable(null);
                  }}
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={receiptMutation.isPending}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  {receiptMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเงิน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Section 4c: Detail Modal */}
      {showDetailModal && selectedReceivable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">รายละเอียดตัดจ่ายไฟแนนซ์</h2>
              <button
                onClick={() => {
                  setShowDetailModal(false);
                  setSelectedReceivable(null);
                }}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                &times;
              </button>
            </div>
            {isDetailLoading ? (
              <div className="p-8 text-center text-gray-500">กำลังโหลด...</div>
            ) : (
              <div className="p-4 space-y-4">
                {/* Receivable Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">เลขที่อ้างอิง</p>
                    <p className="font-medium">
                      {detailData?.referenceNumber ?? selectedReceivable.referenceNumber}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">บริษัทไฟแนนซ์</p>
                    <p className="font-medium">
                      {detailData?.financeCompany?.name ??
                        selectedReceivable.financeCompany?.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">สาขา</p>
                    <p className="font-medium">
                      {detailData?.branch?.name ?? selectedReceivable.branch?.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">สัญญา</p>
                    <p className="font-medium">
                      {detailData?.contract?.contractNumber ?? '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">ยอดที่คาด</p>
                    <p className="font-medium">
                      ฿{formatCurrency(detailData?.expectedAmount ?? selectedReceivable.expectedAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">ยอดรับแล้ว</p>
                    <p className="font-medium text-green-600">
                      ฿{formatCurrency(detailData?.receivedAmount ?? selectedReceivable.receivedAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">ยอดค้าง</p>
                    <p className="font-medium text-orange-600">
                      ฿{formatCurrency(detailData?.outstandingAmount ?? selectedReceivable.outstandingAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">สถานะ</p>
                    {(() => {
                      const s = detailData?.status ?? selectedReceivable.status;
                      const cfg = statusConfig[s] ?? {
                        label: s,
                        className: 'bg-gray-100 text-gray-800',
                      };
                      return (
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${cfg.className}`}
                        >
                          {cfg.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">กำหนดรับ</p>
                    <p className="font-medium">
                      {formatDate(detailData?.dueDate ?? selectedReceivable.dueDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">สร้างโดย</p>
                    <p className="font-medium">
                      {detailData?.createdBy?.name ?? selectedReceivable.createdBy?.name}
                    </p>
                  </div>
                </div>

                {(detailData?.notes || selectedReceivable.notes) && (
                  <div>
                    <p className="text-xs text-gray-500">หมายเหตุ</p>
                    <p className="text-sm">{detailData?.notes ?? selectedReceivable.notes}</p>
                  </div>
                )}

                {/* Receipt History */}
                <div>
                  <h3 className="font-medium text-sm mb-2">ประวัติการรับเงิน</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="text-left px-3 py-2 font-medium text-gray-600">
                            วันที่
                          </th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600">
                            จำนวนเงิน
                          </th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">
                            วิธีชำระ
                          </th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">
                            อ้างอิง
                          </th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">
                            บันทึกโดย
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detailData?.receipts ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={5} className="text-center py-4 text-gray-500">
                              ยังไม่มีรายการรับเงิน
                            </td>
                          </tr>
                        ) : (
                          (detailData?.receipts ?? []).map((receipt) => (
                            <tr key={receipt.id} className="border-b">
                              <td className="px-3 py-2">{formatDate(receipt.paymentDate)}</td>
                              <td className="px-3 py-2 text-right text-green-600">
                                ฿{formatCurrency(receipt.amount)}
                              </td>
                              <td className="px-3 py-2">
                                {receipt.paymentMethod
                                  ? paymentMethodLabels[receipt.paymentMethod] ??
                                    receipt.paymentMethod
                                  : '-'}
                              </td>
                              <td className="px-3 py-2">{receipt.referenceNumber ?? '-'}</td>
                              <td className="px-3 py-2">{receipt.recordedBy?.name}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDetailModal(false);
                      setSelectedReceivable(null);
                    }}
                    className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                  >
                    ปิด
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

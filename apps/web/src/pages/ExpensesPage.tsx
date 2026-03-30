import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Receipt, Plus, Pencil, Trash2, Search, Calculator, BarChart3 } from 'lucide-react';

interface Expense {
  id: string;
  expenseNumber: string;
  branchId: string;
  branch: { name: string };
  category: string;
  customCategory: string | null;
  description: string;
  amount: string;
  expenseDate: string;
  month: number;
  year: number;
  paymentMethod: string | null;
  referenceNumber: string | null;
  evidenceUrls: string[];
  notes: string | null;
  isRecurring: boolean;
  createdBy: { name: string };
  createdAt: string;
}

interface CategorySummary {
  category: string;
  label: string;
  amount: string;
  count: number;
  percentage: number;
}

interface MonthlySummaryResponse {
  month: number;
  year: number;
  total: string;
  itemCount: number;
  categories: CategorySummary[];
}

interface MonthlyComparison {
  month: number;
  year: number;
  total: number;
  categories: Record<string, number>;
}

interface Branch {
  id: string;
  name: string;
}

const categoryLabels: Record<string, string> = {
  RENT: 'ค่าเช่า',
  UTILITIES: 'ค่าน้ำค่าไฟ',
  SALARY: 'เงินเดือน',
  COMMISSION: 'ค่าคอมมิชชั่น',
  TRANSPORTATION: 'ค่าขนส่ง',
  OFFICE_SUPPLIES: 'วัสดุสำนักงาน',
  MARKETING: 'ค่าการตลาด',
  INSURANCE: 'ค่าประกัน',
  MAINTENANCE: 'ค่าบำรุงรักษา',
  TAXES: 'ภาษี',
  INTERNET: 'ค่าอินเทอร์เน็ต',
  PHONE_BILL: 'ค่าโทรศัพท์',
  MISCELLANEOUS: 'เบ็ดเตล็ด',
  OTHER: 'อื่นๆ',
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  QR_EWALLET: 'QR/E-Wallet',
  CREDIT_BALANCE: 'เครดิต',
  ONLINE_GATEWAY: 'ออนไลน์',
};

const thaiMonths = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const thaiMonthsFull = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

function formatCurrency(value: string | number): string {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 }).format(Number(value));
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('th-TH');
}

const emptyForm = {
  branchId: '',
  category: '',
  customCategory: '',
  description: '',
  amount: '',
  expenseDate: new Date().toISOString().split('T')[0],
  paymentMethod: '',
  referenceNumber: '',
  notes: '',
  isRecurring: false,
};

export default function ExpensesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = user?.role === 'OWNER';

  const [activeTab, setActiveTab] = useState('list');

  // List tab state
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());
  const [page, setPage] = useState(1);
  const limit = 20;

  // Summary tab state
  const [summaryMonth, setSummaryMonth] = useState<number>(new Date().getMonth() + 1);
  const [summaryYear, setSummaryYear] = useState<number>(new Date().getFullYear());
  const [summaryBranch, setSummaryBranch] = useState('');

  // Comparison tab state
  const [comparisonBranch, setComparisonBranch] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterBranch, filterCategory, filterMonth, filterYear]);

  // Branches query
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  // Expenses list query
  const { data: expensesResult, isLoading: isLoadingExpenses } = useQuery<{
    data: Expense[];
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ['expenses', debouncedSearch, filterBranch, filterCategory, filterMonth, filterYear, page],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page), limit: String(limit) };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterBranch) params.branchId = filterBranch;
      if (filterCategory) params.category = filterCategory;
      if (filterMonth) params.month = String(filterMonth);
      if (filterYear) params.year = String(filterYear);
      const { data } = await api.get('/expenses', { params });
      return data;
    },
    enabled: activeTab === 'list',
  });

  const expenses = expensesResult?.data ?? [];
  const totalItems = expensesResult?.total ?? 0;
  const totalPages = Math.ceil(totalItems / limit);

  // Monthly summary query
  const { data: summaryData, isLoading: isLoadingSummary } = useQuery<MonthlySummaryResponse>({
    queryKey: ['expenses', 'summary', summaryMonth, summaryYear, summaryBranch],
    queryFn: async () => {
      const params: Record<string, string> = {
        month: String(summaryMonth),
        year: String(summaryYear),
      };
      if (summaryBranch) params.branchId = summaryBranch;
      const { data } = await api.get('/expenses/summary', { params });
      return data;
    },
    enabled: activeTab === 'summary',
  });

  // Monthly comparison query
  const { data: comparisonData, isLoading: isLoadingComparison } = useQuery<MonthlyComparison[]>({
    queryKey: ['expenses', 'monthly-comparison', comparisonBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (comparisonBranch) params.branchId = comparisonBranch;
      const { data } = await api.get('/expenses/monthly-comparison', { params });
      return data;
    },
    enabled: activeTab === 'comparison',
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editingExpense) {
        const { data } = await api.patch(`/expenses/${editingExpense.id}`, payload);
        return data;
      }
      const { data } = await api.post('/expenses', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editingExpense ? 'แก้ไขค่าใช้จ่ายสำเร็จ' : 'เพิ่มค่าใช้จ่ายสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      closeModal();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/expenses/${id}`);
    },
    onSuccess: () => {
      toast.success('ลบค่าใช้จ่ายสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  function openCreateModal() {
    setEditingExpense(null);
    setForm({ ...emptyForm, branchId: user?.branchId ?? '' });
    setIsModalOpen(true);
  }

  function openEditModal(expense: Expense) {
    setEditingExpense(expense);
    setForm({
      branchId: expense.branchId,
      category: expense.category,
      customCategory: expense.customCategory ?? '',
      description: expense.description,
      amount: expense.amount,
      expenseDate: expense.expenseDate.split('T')[0],
      paymentMethod: expense.paymentMethod ?? '',
      referenceNumber: expense.referenceNumber ?? '',
      notes: expense.notes ?? '',
      isRecurring: expense.isRecurring,
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingExpense(null);
    setForm(emptyForm);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) {
      toast.error('กรุณาระบุรายละเอียด');
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error('กรุณาระบุจำนวนเงิน');
      return;
    }
    const payload: Record<string, unknown> = {
      branchId: form.branchId || undefined,
      category: form.category || undefined,
      customCategory: form.category === 'OTHER' ? form.customCategory : undefined,
      description: form.description,
      amount: Number(form.amount),
      expenseDate: form.expenseDate,
      paymentMethod: form.paymentMethod || undefined,
      referenceNumber: form.referenceNumber || undefined,
      notes: form.notes || undefined,
      isRecurring: form.isRecurring,
    };
    saveMutation.mutate(payload);
  }

  function handleDelete(expense: Expense) {
    if (confirm(`ต้องการลบรายการ "${expense.description}" หรือไม่?`)) {
      deleteMutation.mutate(expense.id);
    }
  }

  // Year options
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div>
      <PageHeader
        title="ค่าใช้จ่าย"
        subtitle="จัดการค่าใช้จ่ายของร้าน"
        action={
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            เพิ่มค่าใช้จ่าย
          </button>
        }
      />

      {/* Tab bar */}
      <div className="flex border-b mb-6">
        {[
          { key: 'list', label: 'รายการ', icon: Receipt },
          { key: 'summary', label: 'สรุปรายเดือน', icon: Calculator },
          { key: 'comparison', label: 'เปรียบเทียบ', icon: BarChart3 },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: รายการ */}
      {activeTab === 'list' && (
        <div>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="ค้นหา..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {isOwner && (
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">ทุกสาขา</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">ทุกหมวด</option>
              {Object.entries(categoryLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {thaiMonthsFull.map((m, i) => (
                <option key={i + 1} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>

            <select
              value={filterYear}
              onChange={(e) => setFilterYear(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y + 543}
                </option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    เลขที่
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    วันที่
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    หมวด
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    รายละเอียด
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                    จำนวน (฿)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    สาขา
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    วิธีชำระ
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    ผู้บันทึก
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    จัดการ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {isLoadingExpenses ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                      ไม่พบรายการค่าใช้จ่าย
                    </td>
                  </tr>
                ) : (
                  expenses.map((expense) => (
                    <tr key={expense.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                        {expense.expenseNumber}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {formatDate(expense.expenseDate)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {expense.category === 'OTHER' && expense.customCategory
                          ? expense.customCategory
                          : categoryLabels[expense.category] ?? expense.category}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-sm text-gray-600">
                        {expense.description}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">
                        {formatCurrency(expense.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {expense.branch?.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {expense.paymentMethod
                          ? paymentMethodLabels[expense.paymentMethod] ?? expense.paymentMethod
                          : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {expense.createdBy?.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEditModal(expense)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                            title="แก้ไข"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {isOwner && (
                            <button
                              onClick={() => handleDelete(expense)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                              title="ลบ"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                แสดง {(page - 1) * limit + 1}-{Math.min(page * limit, totalItems)} จาก {totalItems}{' '}
                รายการ
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
                >
                  ก่อนหน้า
                </button>
                <span className="text-sm text-gray-600">
                  หน้า {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: สรุปรายเดือน */}
      {activeTab === 'summary' && (
        <div>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              value={summaryMonth}
              onChange={(e) => setSummaryMonth(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {thaiMonthsFull.map((m, i) => (
                <option key={i + 1} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>

            <select
              value={summaryYear}
              onChange={(e) => setSummaryYear(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y + 543}
                </option>
              ))}
            </select>

            {isOwner && (
              <select
                value={summaryBranch}
                onChange={(e) => setSummaryBranch(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">ทุกสาขา</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {isLoadingSummary ? (
            <p className="text-sm text-gray-500">กำลังโหลด...</p>
          ) : summaryData ? (
            <>
              {/* Summary cards */}
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-sm text-gray-500">ค่าใช้จ่ายรวม</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">
                    ฿{formatCurrency(summaryData.total)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-sm text-gray-500">จำนวนรายการ</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">
                    {summaryData.itemCount} รายการ
                  </p>
                </div>
              </div>

              {/* Category breakdown */}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        หมวด
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                        จำนวนเงิน
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                        สัดส่วน (%)
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 w-1/3">
                        &nbsp;
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {summaryData.categories.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                          ไม่มีข้อมูล
                        </td>
                      </tr>
                    ) : (
                      summaryData.categories.map((cat) => (
                        <tr key={cat.category} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                            {cat.label || categoryLabels[cat.category] || cat.category}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                            ฿{formatCurrency(cat.amount)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-600">
                            {cat.percentage.toFixed(1)}%
                          </td>
                          <td className="px-4 py-3">
                            <div className="h-2 w-full rounded-full bg-gray-200">
                              <div
                                className="h-2 rounded-full bg-blue-500"
                                style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">ไม่มีข้อมูล</p>
          )}
        </div>
      )}

      {/* Tab 3: เปรียบเทียบ */}
      {activeTab === 'comparison' && (
        <div>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {isOwner && (
              <select
                value={comparisonBranch}
                onChange={(e) => setComparisonBranch(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">ทุกสาขา</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {isLoadingComparison ? (
            <p className="text-sm text-gray-500">กำลังโหลด...</p>
          ) : comparisonData && comparisonData.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      หมวด
                    </th>
                    {comparisonData.map((m) => (
                      <th
                        key={`${m.month}-${m.year}`}
                        className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500"
                      >
                        {thaiMonths[m.month - 1]} {m.year + 543}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {/* Collect all unique categories */}
                  {(() => {
                    const allCategories = new Set<string>();
                    comparisonData.forEach((m) => {
                      Object.keys(m.categories).forEach((c) => allCategories.add(c));
                    });
                    const categories = Array.from(allCategories);

                    return (
                      <>
                        {categories.map((cat) => (
                          <tr key={cat} className="hover:bg-gray-50">
                            <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                              {categoryLabels[cat] ?? cat}
                            </td>
                            {comparisonData.map((m) => (
                              <td
                                key={`${m.month}-${m.year}-${cat}`}
                                className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-600"
                              >
                                {m.categories[cat]
                                  ? formatCurrency(m.categories[cat])
                                  : '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {/* Total row */}
                        <tr className="bg-gray-50 font-semibold">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                            รวม
                          </td>
                          {comparisonData.map((m) => (
                            <td
                              key={`total-${m.month}-${m.year}`}
                              className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900"
                            >
                              {formatCurrency(m.total)}
                            </td>
                          ))}
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">ไม่มีข้อมูลเปรียบเทียบ</p>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">
              {editingExpense ? 'แก้ไขค่าใช้จ่าย' : 'เพิ่มค่าใช้จ่าย'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Branch */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">สาขา</label>
                <select
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">เลือกสาขา</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">หมวดหมู่</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">เลือกหมวดหมู่</option>
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom category */}
              {form.category === 'OTHER' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    ระบุหมวดหมู่
                  </label>
                  <input
                    type="text"
                    value={form.customCategory}
                    onChange={(e) => setForm({ ...form, customCategory: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="ระบุหมวดหมู่อื่นๆ"
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  รายละเอียด <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="รายละเอียดค่าใช้จ่าย"
                  required
                />
              </div>

              {/* Amount */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  จำนวนเงิน (฿) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="0.00"
                  required
                />
              </div>

              {/* Expense date */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">วันที่</label>
                <input
                  type="date"
                  value={form.expenseDate}
                  onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Payment method */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">วิธีชำระ</label>
                <select
                  value={form.paymentMethod}
                  onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">เลือกวิธีชำระ</option>
                  {Object.entries(paymentMethodLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reference number */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  เลขที่อ้างอิง
                </label>
                <input
                  type="text"
                  value={form.referenceNumber}
                  onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="เลขที่อ้างอิง (ถ้ามี)"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">หมายเหตุ</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="หมายเหตุ (ถ้ามี)"
                />
              </div>

              {/* Is recurring */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isRecurring"
                  checked={form.isRecurring}
                  onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isRecurring" className="text-sm text-gray-700">
                  ค่าใช้จ่ายประจำ (Recurring)
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

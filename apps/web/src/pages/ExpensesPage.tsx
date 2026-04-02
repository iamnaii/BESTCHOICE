import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { Receipt, Plus } from 'lucide-react';

interface Expense {
  id: string;
  expenseNumber: string;
  accountType: string;
  category: string;
  accountCode: string | null;
  description: string;
  amount: string;
  vatAmount: string;
  totalAmount: string;
  withholdingTax: string;
  expenseDate: string;
  paymentMethod: string | null;
  paymentDate: string | null;
  reference: string | null;
  vendorName: string | null;
  vendorTaxId: string | null;
  receiptImageUrl: string | null;
  taxInvoiceNo: string | null;
  status: string;
  rejectReason: string | null;
  note: string | null;
  isRecurring: boolean;
  createdAt: string;
  branch: { id: string; name: string };
  createdBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
}

interface Summary {
  totalAmount: number;
  totalCount: number;
  pendingCount: number;
  byAccountType: Record<string, number>;
}

const accountTypeLabels: Record<string, string> = {
  COST_OF_SALES: '5100 ต้นทุนขาย',
  SELLING_EXPENSE: '5200 ค่าใช้จ่ายในการขาย',
  ADMINISTRATIVE_EXPENSE: '5300 ค่าใช้จ่ายในการบริหาร',
  OTHER_EXPENSE: '5900 ค่าใช้จ่ายอื่น',
};

const categoryLabels: Record<string, string> = {
  COGS_PRODUCT: 'ต้นทุนสินค้า',
  COGS_REPAIR_PARTS: 'อะไหล่/ซ่อม',
  SELL_COMMISSION: 'ค่าคอมมิชชั่น',
  SELL_ADVERTISING: 'ค่าโฆษณา/การตลาด',
  SELL_TRANSPORT: 'ค่าขนส่ง',
  SELL_PACKAGING: 'ค่าบรรจุภัณฑ์',
  ADMIN_SALARY: 'เงินเดือน/ค่าจ้าง',
  ADMIN_SOCIAL_SECURITY: 'ประกันสังคม',
  ADMIN_RENT: 'ค่าเช่าสถานที่',
  ADMIN_UTILITIES: 'ค่าน้ำ/ไฟ/เน็ต',
  ADMIN_OFFICE_SUPPLIES: 'วัสดุสำนักงาน',
  ADMIN_DEPRECIATION: 'ค่าเสื่อมราคา',
  ADMIN_INSURANCE: 'ค่าประกันภัย',
  ADMIN_TAX_FEE: 'ภาษี/ค่าธรรมเนียม',
  ADMIN_MAINTENANCE: 'ค่าซ่อมบำรุง',
  ADMIN_TRAVEL: 'ค่าเดินทาง',
  ADMIN_TELEPHONE: 'ค่าโทรศัพท์',
  OTHER_INTEREST: 'ดอกเบี้ยจ่าย',
  OTHER_LOSS: 'ขาดทุนจำหน่ายสินทรัพย์',
  OTHER_FINE: 'ค่าปรับ',
  OTHER_MISC: 'เบ็ดเตล็ด',
};

const statusLabels: Record<string, string> = {
  DRAFT: 'ร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  PAID: 'จ่ายแล้ว',
  VOIDED: 'ยกเลิก',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  PAID: 'bg-green-100 text-green-700',
  VOIDED: 'bg-muted text-muted-foreground line-through',
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/e-Wallet',
};

// Categories grouped by account type for the form
const categoryGroups: Record<string, { value: string; label: string }[]> = {
  COST_OF_SALES: [
    { value: 'COGS_PRODUCT', label: '5101 ต้นทุนสินค้า' },
    { value: 'COGS_REPAIR_PARTS', label: '5102 อะไหล่/ซ่อม' },
  ],
  SELLING_EXPENSE: [
    { value: 'SELL_COMMISSION', label: '5201 ค่าคอมมิชชั่น' },
    { value: 'SELL_ADVERTISING', label: '5202 ค่าโฆษณา/การตลาด' },
    { value: 'SELL_TRANSPORT', label: '5203 ค่าขนส่ง' },
    { value: 'SELL_PACKAGING', label: '5204 ค่าบรรจุภัณฑ์' },
  ],
  ADMINISTRATIVE_EXPENSE: [
    { value: 'ADMIN_SALARY', label: '5301 เงินเดือน/ค่าจ้าง' },
    { value: 'ADMIN_SOCIAL_SECURITY', label: '5302 ประกันสังคม' },
    { value: 'ADMIN_RENT', label: '5303 ค่าเช่าสถานที่' },
    { value: 'ADMIN_UTILITIES', label: '5304 ค่าน้ำ/ไฟ/เน็ต' },
    { value: 'ADMIN_OFFICE_SUPPLIES', label: '5305 วัสดุสำนักงาน' },
    { value: 'ADMIN_DEPRECIATION', label: '5306 ค่าเสื่อมราคา' },
    { value: 'ADMIN_INSURANCE', label: '5307 ค่าประกันภัย' },
    { value: 'ADMIN_TAX_FEE', label: '5308 ภาษี/ค่าธรรมเนียม' },
    { value: 'ADMIN_MAINTENANCE', label: '5309 ค่าซ่อมบำรุง' },
    { value: 'ADMIN_TRAVEL', label: '5310 ค่าเดินทาง' },
    { value: 'ADMIN_TELEPHONE', label: '5311 ค่าโทรศัพท์' },
  ],
  OTHER_EXPENSE: [
    { value: 'OTHER_INTEREST', label: '5901 ดอกเบี้ยจ่าย' },
    { value: 'OTHER_LOSS', label: '5902 ขาดทุนจำหน่ายสินทรัพย์' },
    { value: 'OTHER_FINE', label: '5903 ค่าปรับ' },
    { value: 'OTHER_MISC', label: '5999 เบ็ดเตล็ด' },
  ],
};

const inputClass = 'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const emptyForm = {
  branchId: '',
  accountType: 'ADMINISTRATIVE_EXPENSE',
  category: 'ADMIN_UTILITIES',
  description: '',
  amount: '',
  vatAmount: '0',
  withholdingTax: '0',
  expenseDate: new Date().toISOString().split('T')[0],
  paymentMethod: '',
  vendorName: '',
  reference: '',
  note: '',
};

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isOwner = currentUser?.role === 'OWNER';
  const [statusFilter, setStatusFilter] = useState('');
  const [accountTypeFilter, setAccountTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['expenses-summary'],
    queryFn: async () => (await api.get('/expenses/summary')).data,
  });

  const { data: expensesData, isLoading } = useQuery<{ data: Expense[]; total: number }>({
    queryKey: ['expenses', statusFilter, accountTypeFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (statusFilter) params.set('status', statusFilter);
      if (accountTypeFilter) params.set('accountType', accountTypeFilter);
      if (search) params.set('search', search);
      return (await api.get(`/expenses?${params}`)).data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => api.post('/expenses', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
      toast.success('บันทึกรายจ่ายสำเร็จ');
      setIsCreateModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: Record<string, unknown> }) =>
      api.post(`/expenses/${id}/${action}`, body || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
      toast.success('อัปเดตสถานะสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    const vatAmount = parseFloat(form.vatAmount) || 0;
    const withholdingTax = parseFloat(form.withholdingTax) || 0;
    createMutation.mutate({
      branchId: form.branchId || branches[0]?.id,
      accountType: form.accountType,
      category: form.category,
      description: form.description,
      amount,
      vatAmount,
      withholdingTax,
      expenseDate: form.expenseDate,
      paymentMethod: form.paymentMethod || undefined,
      vendorName: form.vendorName || undefined,
      reference: form.reference || undefined,
      note: form.note || undefined,
    });
  };

  const availableCategories = categoryGroups[form.accountType] || [];

  const columns = [
    {
      key: 'expenseNumber', label: 'เลขที่',
      render: (e: Expense) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground">{e.expenseNumber}</div>
          <div className="text-xs text-muted-foreground">{e.accountCode}</div>
        </div>
      ),
    },
    {
      key: 'description', label: 'รายละเอียด',
      render: (e: Expense) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{e.description}</div>
          <div className="text-xs text-muted-foreground">{categoryLabels[e.category] || e.category}</div>
        </div>
      ),
    },
    { key: 'branch', label: 'สาขา', render: (e: Expense) => e.branch.name },
    {
      key: 'vendorName', label: 'ผู้รับเงิน',
      render: (e: Expense) => e.vendorName || '-',
    },
    {
      key: 'totalAmount', label: 'จำนวนเงิน',
      render: (e: Expense) => (
        <div className="text-right">
          <div className="font-medium">{fmt(e.totalAmount)}</div>
          {Number(e.vatAmount) > 0 && (
            <div className="text-xs text-muted-foreground">VAT {fmt(e.vatAmount)}</div>
          )}
        </div>
      ),
    },
    {
      key: 'expenseDate', label: 'วันที่',
      render: (e: Expense) => new Date(e.expenseDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
    },
    {
      key: 'status', label: 'สถานะ',
      render: (e: Expense) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[e.status] || 'bg-muted'}`}>
          {statusLabels[e.status] || e.status}
        </span>
      ),
    },
    {
      key: 'actions', label: '',
      render: (e: Expense) => {
        if (e.status === 'VOIDED' || e.status === 'PAID') return null;
        return (
          <div className="flex items-center gap-2">
            {e.status === 'DRAFT' && (
              <button
                onClick={() => setConfirmDialog({ open: true, message: `ส่งอนุมัติ "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'submit' }) })}
                className="text-primary hover:text-primary/80 text-sm font-medium"
              >
                ส่งอนุมัติ
              </button>
            )}
            {e.status === 'PENDING_APPROVAL' && isOwner && (
              <>
                <button
                  onClick={() => setConfirmDialog({ open: true, message: `อนุมัติ "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'approve' }) })}
                  className="text-green-600 hover:text-green-700 text-sm font-medium"
                >
                  อนุมัติ
                </button>
                <button
                  onClick={() => {
                    const reason = prompt('เหตุผลที่ไม่อนุมัติ:');
                    if (reason) actionMutation.mutate({ id: e.id, action: 'reject', body: { reason } });
                  }}
                  className="text-red-500 hover:text-red-600 text-sm font-medium"
                >
                  ไม่อนุมัติ
                </button>
              </>
            )}
            {e.status === 'APPROVED' && (
              <button
                onClick={() => setConfirmDialog({ open: true, message: `บันทึกจ่ายเงิน "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'pay' }) })}
                className="text-green-600 hover:text-green-700 text-sm font-medium"
              >
                จ่ายแล้ว
              </button>
            )}
            {e.status === 'REJECTED' && (
              <button
                onClick={() => setConfirmDialog({ open: true, message: `ส่งอนุมัติอีกครั้ง "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'submit' }) })}
                className="text-primary hover:text-primary/80 text-sm font-medium"
              >
                ส่งอีกครั้ง
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="บันทึกรายจ่าย"
        subtitle={`ทั้งหมด ${expensesData?.total || 0} รายการ`}
        icon={<Receipt className="size-6" />}
        action={
          <button
            onClick={() => { setForm({ ...emptyForm, branchId: branches[0]?.id || '' }); setIsCreateModalOpen(true); }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5"
          >
            <Plus className="size-4" />
            บันทึกรายจ่าย
          </button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <span className="text-sm text-muted-foreground">รายจ่ายทั้งหมด</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(summary?.totalAmount)}</div>
            <div className="text-sm text-muted-foreground">{summary?.totalCount || 0} รายการ</div>
          </CardContent>
        </Card>
        {Object.entries(accountTypeLabels).map(([key, label]) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <span className="text-sm text-muted-foreground">{label.split(' ').slice(1).join(' ')}</span>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{fmt(summary?.byAccountType?.[key] || 0)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${inputClass} w-auto min-w-[140px]`}
        >
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={accountTypeFilter}
          onChange={(e) => setAccountTypeFilter(e.target.value)}
          className={`${inputClass} w-auto min-w-[180px]`}
        >
          <option value="">ทุกหมวดบัญชี</option>
          {Object.entries(accountTypeLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="ค้นหา เลขที่, รายละเอียด, ผู้รับเงิน..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} w-auto min-w-[250px]`}
        />
      </div>

      <DataTable columns={columns} data={expensesData?.data || []} isLoading={isLoading} />

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="บันทึกรายจ่าย">
        <form onSubmit={handleCreate} className="space-y-4">
          {/* Account type + category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมวดบัญชีหลัก *</label>
              <select
                value={form.accountType}
                onChange={(e) => {
                  const newType = e.target.value;
                  const firstCat = categoryGroups[newType]?.[0]?.value || '';
                  setForm({ ...form, accountType: newType, category: firstCat });
                }}
                className={inputClass}
              >
                {Object.entries(accountTypeLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมวดย่อย *</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className={inputClass}
              >
                {availableCategories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">รายละเอียด *</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
              placeholder="เช่น ค่าไฟฟ้าเดือน เม.ย. 2569"
              className={inputClass}
            />
          </div>

          {/* Amount + VAT */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">จำนวนเงิน (ไม่รวม VAT) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">VAT</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.vatAmount}
                onChange={(e) => setForm({ ...form, vatAmount: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ภาษีหัก ณ ที่จ่าย</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.withholdingTax}
                onChange={(e) => setForm({ ...form, withholdingTax: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          {/* Date + Branch + Payment method */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วันที่เกิดรายจ่าย *</label>
              <input
                type="date"
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">สาขา *</label>
              <select
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                required
                className={inputClass}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วิธีจ่ายเงิน</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                className={inputClass}
              >
                <option value="">ยังไม่จ่าย</option>
                {Object.entries(paymentMethodLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Vendor + Reference */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ผู้รับเงิน / ร้านค้า</label>
              <input
                type="text"
                value={form.vendorName}
                onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
                placeholder="เช่น การไฟฟ้านครหลวง"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">เลขอ้างอิง</label>
              <input
                type="text"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="เช่น เลขที่บิล, เลขเช็ค"
                className={inputClass}
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
              className={inputClass}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        description={confirmDialog.message}
        onConfirm={confirmDialog.action}
      />
    </div>
  );
}

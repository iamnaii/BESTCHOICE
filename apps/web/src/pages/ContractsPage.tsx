import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';

interface Contract {
  id: string;
  contractNumber: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  planType: string;
  sellingPrice: number;
  downPayment: number;
  financedAmount: number;
  interestRate: number;
  totalMonths: number;
  monthlyPayment: number;
  status: string;
  _count: { payments: number };
  createdAt: string;
}

interface Customer { id: string; name: string; phone: string; }
interface Product { id: string; name: string; brand: string; model: string; costPrice: number; branch: { id: string; name: string }; }

const statusLabels: Record<string, string> = {
  DRAFT: 'ร่าง', ACTIVE: 'ใช้งาน', OVERDUE: 'เกินกำหนด', DEFAULT: 'ผิดนัด',
  EARLY_PAYOFF: 'ปิดก่อนกำหนด', COMPLETED: 'เสร็จสิ้น', EXCHANGED: 'เปลี่ยนเครื่อง', CLOSED_BAD_DEBT: 'หนี้สูญ',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700', ACTIVE: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-orange-100 text-orange-700', DEFAULT: 'bg-red-100 text-red-700',
  EARLY_PAYOFF: 'bg-purple-100 text-purple-700', COMPLETED: 'bg-blue-100 text-blue-700',
  EXCHANGED: 'bg-yellow-100 text-yellow-700', CLOSED_BAD_DEBT: 'bg-red-100 text-red-800',
};

const planLabels: Record<string, string> = {
  STORE_DIRECT: 'ผ่อนร้าน', CREDIT_CARD: 'บัตรเครดิต', STORE_WITH_INTEREST: 'ผ่อนร้าน+ดอกเบี้ย',
};

export default function ContractsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [detailContract, setDetailContract] = useState<Contract | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    customerId: '', productId: '', branchId: '', planType: 'STORE_DIRECT',
    sellingPrice: 0, downPayment: 0, interestRate: 0.08, totalMonths: 6, notes: '',
  });

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ['contracts', statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      const { data } = await api.get(`/contracts?${params}`);
      return data;
    },
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-list'],
    queryFn: async () => { const { data } = await api.get('/customers'); return data; },
    enabled: isCreateOpen,
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-available'],
    queryFn: async () => { const { data } = await api.get('/products?status=IN_STOCK'); return data; },
    enabled: isCreateOpen,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return api.post('/contracts', {
        ...data,
        sellingPrice: Number(data.sellingPrice),
        downPayment: Number(data.downPayment),
        interestRate: Number(data.interestRate),
        totalMonths: Number(data.totalMonths),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('สร้างสัญญาสำเร็จ');
      setIsCreateOpen(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const handleProductSelect = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    setForm({
      ...form,
      productId,
      branchId: p?.branch.id || form.branchId,
      sellingPrice: Number(p?.costPrice || 0),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  // Calculate preview
  const financedAmount = form.sellingPrice - form.downPayment;
  const interestTotal = financedAmount * form.interestRate * form.totalMonths;
  const monthly = form.totalMonths > 0 ? Math.ceil((financedAmount + interestTotal) / form.totalMonths) : 0;

  const columns = [
    {
      key: 'contractNumber', label: 'เลขสัญญา',
      render: (c: Contract) => (
        <button onClick={() => setDetailContract(c)} className="text-primary-600 hover:text-primary-700 font-medium">
          {c.contractNumber}
        </button>
      ),
    },
    {
      key: 'customer', label: 'ลูกค้า',
      render: (c: Contract) => (
        <div>
          <div className="font-medium">{c.customer.name}</div>
          <div className="text-xs text-gray-500">{c.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'product', label: 'สินค้า',
      render: (c: Contract) => (
        <div className="text-sm">{c.product.brand} {c.product.model}</div>
      ),
    },
    { key: 'planType', label: 'แผน', render: (c: Contract) => planLabels[c.planType] || c.planType },
    {
      key: 'sellingPrice', label: 'ราคาขาย',
      render: (c: Contract) => Number(c.sellingPrice).toLocaleString('th-TH') + ' ฿',
    },
    {
      key: 'monthlyPayment', label: 'ค่างวด/เดือน',
      render: (c: Contract) => (
        <div>
          <div>{Number(c.monthlyPayment).toLocaleString('th-TH')} ฿</div>
          <div className="text-xs text-gray-500">{c.totalMonths} งวด</div>
        </div>
      ),
    },
    {
      key: 'status', label: 'สถานะ',
      render: (c: Contract) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[c.status] || 'bg-gray-100 text-gray-700'}`}>
          {statusLabels[c.status] || c.status}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="สัญญาผ่อนชำระ"
        subtitle={`ทั้งหมด ${contracts.length} สัญญา`}
        action={
          <button onClick={() => setIsCreateOpen(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors">
            + สร้างสัญญา
          </button>
        }
      />

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

      <DataTable columns={columns} data={contracts} isLoading={isLoading} />

      {/* Detail Modal */}
      <Modal isOpen={!!detailContract} onClose={() => setDetailContract(null)} title={`สัญญา ${detailContract?.contractNumber || ''}`}>
        {detailContract && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-500">ลูกค้า:</span> <span className="font-medium">{detailContract.customer.name}</span></div>
              <div><span className="text-gray-500">โทร:</span> <span className="font-medium">{detailContract.customer.phone}</span></div>
              <div><span className="text-gray-500">สินค้า:</span> <span className="font-medium">{detailContract.product.brand} {detailContract.product.model}</span></div>
              <div><span className="text-gray-500">สาขา:</span> <span className="font-medium">{detailContract.branch.name}</span></div>
              <div><span className="text-gray-500">แผน:</span> <span className="font-medium">{planLabels[detailContract.planType]}</span></div>
              <div><span className="text-gray-500">ผู้ขาย:</span> <span className="font-medium">{detailContract.salesperson.name}</span></div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-2">
              <div><span className="text-gray-500">ราคาขาย:</span> <span className="font-semibold">{Number(detailContract.sellingPrice).toLocaleString()} ฿</span></div>
              <div><span className="text-gray-500">เงินดาวน์:</span> <span className="font-semibold">{Number(detailContract.downPayment).toLocaleString()} ฿</span></div>
              <div><span className="text-gray-500">ยอดผ่อน:</span> <span className="font-semibold">{Number(detailContract.financedAmount).toLocaleString()} ฿</span></div>
              <div><span className="text-gray-500">ค่างวด:</span> <span className="font-semibold">{Number(detailContract.monthlyPayment).toLocaleString()} ฿ x {detailContract.totalMonths} เดือน</span></div>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="สร้างสัญญาผ่อนใหม่">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ลูกค้า *</label>
              <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                <option value="">เลือกลูกค้า</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สินค้า (พร้อมขาย) *</label>
              <select value={form.productId} onChange={(e) => handleProductSelect(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                <option value="">เลือกสินค้า</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.brand} {p.model} - {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">แผนผ่อน *</label>
              <select value={form.planType} onChange={(e) => setForm({ ...form, planType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                {Object.entries(planLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ราคาขาย *</label>
              <input type="number" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เงินดาวน์ *</label>
              <input type="number" value={form.downPayment} onChange={(e) => setForm({ ...form, downPayment: Number(e.target.value) })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">อัตราดอกเบี้ย/เดือน</label>
              <input type="number" step="0.01" value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนงวด (เดือน) *</label>
              <select value={form.totalMonths} onChange={(e) => setForm({ ...form, totalMonths: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                {[3, 6, 9, 10, 12].map((m) => <option key={m} value={m}>{m} เดือน</option>)}
              </select>
            </div>
          </div>

          {/* Preview calculation */}
          {form.sellingPrice > 0 && form.downPayment >= 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <div className="font-semibold text-blue-800 mb-1">สรุปการคำนวณ</div>
              <div className="grid grid-cols-2 gap-1 text-blue-700">
                <div>ยอดผ่อน: {financedAmount.toLocaleString()} ฿</div>
                <div>ดอกเบี้ยรวม: {interestTotal.toLocaleString()} ฿</div>
                <div>รวมทั้งหมด: {(financedAmount + interestTotal).toLocaleString()} ฿</div>
                <div className="font-semibold">ค่างวด/เดือน: {monthly.toLocaleString()} ฿</div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ยกเลิก</button>
            <button type="submit" disabled={createMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้างสัญญา'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

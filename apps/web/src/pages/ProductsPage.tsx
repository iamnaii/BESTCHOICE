import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: number;
  status: string;
  conditionGrade: string | null;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  createdAt: string;
}

const categoryLabels: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

const statusLabels: Record<string, string> = {
  PO_RECEIVED: 'รับจาก PO',
  INSPECTION: 'ตรวจสอบ',
  IN_STOCK: 'พร้อมขาย',
  RESERVED: 'จองแล้ว',
  SOLD_INSTALLMENT: 'ขายผ่อน',
  SOLD_CASH: 'ขายสด',
  REPOSSESSED: 'ยึดคืน',
  REFURBISHED: 'ซ่อมแล้ว',
  SOLD_RESELL: 'ขายต่อ',
};

const statusColors: Record<string, string> = {
  IN_STOCK: 'bg-green-100 text-green-700',
  RESERVED: 'bg-yellow-100 text-yellow-700',
  SOLD_INSTALLMENT: 'bg-blue-100 text-blue-700',
  SOLD_CASH: 'bg-blue-100 text-blue-700',
  REPOSSESSED: 'bg-red-100 text-red-700',
  INSPECTION: 'bg-orange-100 text-orange-700',
  PO_RECEIVED: 'bg-gray-100 text-gray-700',
  REFURBISHED: 'bg-purple-100 text-purple-700',
  SOLD_RESELL: 'bg-indigo-100 text-indigo-700',
};

export default function ProductsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    name: '', brand: '', model: '', imeiSerial: '', category: 'PHONE_NEW',
    costPrice: 0, branchId: '', conditionGrade: '',
  });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => { const { data } = await api.get('/branches'); return data; },
  });

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products', statusFilter, categoryFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      if (search) params.set('search', search);
      const { data } = await api.get(`/products?${params}`);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, costPrice: Number(data.costPrice), conditionGrade: data.conditionGrade || undefined };
      if (editingProduct) return api.patch(`/products/${editingProduct.id}`, payload);
      return api.post('/products', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(editingProduct ? 'แก้ไขสินค้าสำเร็จ' : 'เพิ่มสินค้าสำเร็จ');
      closeModal();
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  const openCreate = () => {
    setEditingProduct(null);
    setForm({
      name: '', brand: '', model: '', imeiSerial: '', category: 'PHONE_NEW',
      costPrice: 0, branchId: branches[0]?.id || '', conditionGrade: '',
    });
    setIsModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setForm({
      name: p.name, brand: p.brand, model: p.model, imeiSerial: p.imeiSerial || '',
      category: p.category, costPrice: Number(p.costPrice), branchId: p.branch.id,
      conditionGrade: p.conditionGrade || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditingProduct(null); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const canEdit = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const columns = [
    {
      key: 'name', label: 'สินค้า',
      render: (p: Product) => (
        <div>
          <div className="font-medium text-gray-900">{p.name}</div>
          <div className="text-xs text-gray-500">{p.brand} {p.model}</div>
        </div>
      ),
    },
    { key: 'imeiSerial', label: 'IMEI/Serial', render: (p: Product) => p.imeiSerial || '-' },
    { key: 'category', label: 'ประเภท', render: (p: Product) => categoryLabels[p.category] || p.category },
    {
      key: 'costPrice', label: 'ราคาทุน',
      render: (p: Product) => Number(p.costPrice).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿',
    },
    { key: 'branch', label: 'สาขา', render: (p: Product) => p.branch.name },
    {
      key: 'status', label: 'สถานะ',
      render: (p: Product) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[p.status] || 'bg-gray-100 text-gray-700'}`}>
          {statusLabels[p.status] || p.status}
        </span>
      ),
    },
    {
      key: 'actions', label: '',
      render: (p: Product) => canEdit ? (
        <button onClick={() => openEdit(p)} className="text-primary-600 hover:text-primary-700 text-sm font-medium">แก้ไข</button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="จัดการสินค้า"
        subtitle={`ทั้งหมด ${products.length} รายการ`}
        action={canEdit ? (
          <button onClick={openCreate} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors">
            + เพิ่มสินค้า
          </button>
        ) : undefined}
      />

      <div className="flex gap-3 mb-4">
        <input
          type="text" placeholder="ค้นหาชื่อ, ยี่ห้อ, รุ่น, IMEI..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none">
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none">
          <option value="">ทุกประเภท</option>
          {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <DataTable columns={columns} data={products} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingProduct ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อสินค้า *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ยี่ห้อ *</label>
              <input type="text" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">รุ่น *</label>
              <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">IMEI/Serial</label>
              <input type="text" value={form.imeiSerial} onChange={(e) => setForm({ ...form, imeiSerial: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท *</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ราคาทุน *</label>
              <input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สาขา *</label>
              <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                <option value="">เลือกสาขา</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เกรดสภาพ</label>
              <select value={form.conditionGrade} onChange={(e) => setForm({ ...form, conditionGrade: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                <option value="">ไม่ระบุ</option>
                <option value="A">A - ดีมาก</option>
                <option value="B">B - ดี</option>
                <option value="C">C - ปานกลาง</option>
                <option value="D">D - ต้องซ่อม</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ยกเลิก</button>
            <button type="submit" disabled={saveMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

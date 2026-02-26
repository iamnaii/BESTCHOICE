import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import AddressForm, { AddressData, emptyAddress, composeAddress } from '@/components/ui/AddressForm';

interface Supplier {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  phoneSecondary: string | null;
  lineId: string | null;
  address: string | null;
  taxId: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { products: number; purchaseOrders: number };
}

const emptyForm = {
  name: '',
  contactName: '',
  phone: '',
  phoneSecondary: '',
  lineId: '',
  taxId: '',
  notes: '',
};

export default function SuppliersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState<string>('all');
  const [supplierAddress, setSupplierAddress] = useState<AddressData>(emptyAddress);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  useEffect(() => { setPage(1); }, [debouncedSearch, filterActive]);

  const { data: result, isLoading } = useQuery<{ data: Supplier[]; total: number; page: number; totalPages: number }>({
    queryKey: ['suppliers', debouncedSearch, filterActive, page],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterActive !== 'all') params.isActive = filterActive;
      params.page = String(page);
      const { data } = await api.get('/suppliers', { params });
      return data;
    },
  });

  const suppliers = result?.data ?? [];

  const saveMutation = useMutation({
    mutationFn: async (data: typeof emptyForm) => {
      const composedAddress = composeAddress(supplierAddress);
      const payload = {
        ...data,
        phoneSecondary: data.phoneSecondary || undefined,
        lineId: data.lineId || undefined,
        address: composedAddress || undefined,
        taxId: data.taxId || undefined,
        notes: data.notes || undefined,
      };
      if (editingSupplier) {
        return api.patch(`/suppliers/${editingSupplier.id}`, payload);
      }
      return api.post('/suppliers', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(editingSupplier ? 'แก้ไข Supplier สำเร็จ' : 'สร้าง Supplier สำเร็จ');
      closeModal();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.delete(`/suppliers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('ปิดใช้งาน Supplier สำเร็จ');
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const openCreate = () => {
    setEditingSupplier(null);
    setForm(emptyForm);
    setSupplierAddress(emptyAddress);
    setIsModalOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      phoneSecondary: supplier.phoneSecondary || '',
      lineId: supplier.lineId || '',
      taxId: supplier.taxId || '',
      notes: supplier.notes || '',
    });
    setSupplierAddress(emptyAddress);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSupplier(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const columns = [
    {
      key: 'name',
      label: 'ชื่อ Supplier',
      render: (s: Supplier) => (
        <button
          onClick={() => navigate(`/suppliers/${s.id}`)}
          className="text-primary-600 hover:text-primary-700 font-medium hover:underline text-left"
        >
          {s.name}
        </button>
      ),
    },
    { key: 'contactName', label: 'ผู้ติดต่อ' },
    {
      key: 'phone',
      label: 'เบอร์โทร',
      render: (s: Supplier) => (
        <div>
          <div>{s.phone}</div>
          {s.phoneSecondary && <div className="text-xs text-gray-400">{s.phoneSecondary}</div>}
        </div>
      ),
    },
    {
      key: 'lineId',
      label: 'LINE ID',
      render: (s: Supplier) => <span className="text-gray-500">{s.lineId || '-'}</span>,
    },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (s: Supplier) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            s.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}
        >
          {s.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
        </span>
      ),
    },
    {
      key: '_count',
      label: 'ข้อมูล',
      render: (s: Supplier) => (
        <div className="text-xs text-gray-500">
          {s._count.products} สินค้า | {s._count.purchaseOrders} PO
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (s: Supplier) =>
        isManager ? (
          <div className="flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEdit(s);
              }}
              className="text-primary-600 hover:text-primary-700 text-sm font-medium"
            >
              แก้ไข
            </button>
            {s.isActive && user?.role === 'OWNER' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('ต้องการปิดใช้งาน Supplier นี้?')) {
                    deleteMutation.mutate(s.id);
                  }
                }}
                className="text-red-500 hover:text-red-700 text-sm font-medium"
              >
                ปิดใช้งาน
              </button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="จัดการ Supplier"
        subtitle={`ทั้งหมด ${result?.total ?? 0} ราย`}
        action={
          isManager ? (
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              + เพิ่ม Supplier
            </button>
          ) : undefined
        }
      />

      {/* Search & Filter */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหาชื่อ, ผู้ติดต่อ, เบอร์โทร, Tax ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        >
          <option value="all">ทั้งหมด</option>
          <option value="true">เปิดใช้งาน</option>
          <option value="false">ปิดใช้งาน</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={suppliers}
        isLoading={isLoading}
        emptyMessage="ไม่พบ Supplier"
        pagination={result ? {
          page: result.page,
          totalPages: result.totalPages,
          total: result.total,
          onPageChange: setPage,
        } : undefined}
      />

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingSupplier ? 'แก้ไข Supplier' : 'เพิ่ม Supplier ใหม่'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ Supplier / บริษัท *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อผู้ติดต่อ *</label>
              <input
                type="text"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์โทรศัพท์ *</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์โทรสำรอง</label>
              <input
                type="text"
                value={form.phoneSecondary}
                onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LINE ID</label>
              <input
                type="text"
                value={form.lineId}
                onChange={(e) => setForm({ ...form, lineId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เลข Tax ID</label>
              <input
                type="text"
                value={form.taxId}
                onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div className="col-span-2">
              <AddressForm value={supplierAddress} onChange={setSupplierAddress} label="ที่อยู่" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

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
import AddressForm, { AddressData, emptyAddress, serializeAddress, deserializeAddress } from '@/components/ui/AddressForm';

interface Supplier {
  id: string;
  name: string;
  contactName: string;
  nickname: string | null;
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
  nickname: '',
  phone: '',
  phoneSecondary: '',
  lineId: '',
  taxId: '',
  notes: '',
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatTaxId(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 1) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
  if (digits.length <= 10) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10)}`;
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

export default function SuppliersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState<string>('true');
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
    mutationFn: async ({ formData, addressData, editId }: { formData: typeof emptyForm; addressData: AddressData; editId?: string }) => {
      const serializedAddress = serializeAddress(addressData);
      const payload = {
        ...formData,
        nickname: formData.nickname || undefined,
        phoneSecondary: formData.phoneSecondary || undefined,
        lineId: formData.lineId || undefined,
        address: serializedAddress || undefined,
        taxId: formData.taxId || undefined,
        notes: formData.notes || undefined,
      };
      if (editId) {
        return api.patch(`/suppliers/${editId}`, payload);
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

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return api.patch(`/suppliers/${id}`, { isActive });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(variables.isActive ? 'เปิดใช้งาน Supplier สำเร็จ' : 'ปิดใช้งาน Supplier สำเร็จ');
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
      nickname: supplier.nickname || '',
      phone: supplier.phone,
      phoneSecondary: supplier.phoneSecondary || '',
      lineId: supplier.lineId || '',
      taxId: supplier.taxId || '',
      notes: supplier.notes || '',
    });
    setSupplierAddress(deserializeAddress(supplier.address));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSupplier(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ formData: form, addressData: supplierAddress, editId: editingSupplier?.id });
  };

  const columns = [
    {
      key: 'name',
      label: 'ชื่อ Supplier',
      render: (s: Supplier) => (
        <span className="font-medium text-gray-900">{s.name}</span>
      ),
    },
    {
      key: 'contactName',
      label: 'ผู้ติดต่อ',
      render: (s: Supplier) => (
        <div>
          <div className="text-gray-700">{s.contactName || '-'}</div>
          {s.nickname && <div className="text-xs text-gray-400">({s.nickname})</div>}
        </div>
      ),
    },
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
      key: 'notes',
      label: 'หมายเหตุ',
      render: (s: Supplier) => (
        <span className="text-gray-500 text-sm">{s.notes || '-'}</span>
      ),
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
      key: 'detail',
      label: 'ข้อมูล',
      render: (s: Supplier) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/suppliers/${s.id}`);
          }}
          className="text-primary-600 hover:text-primary-700 text-sm font-medium hover:underline"
        >
          ดูข้อมูล
        </button>
      ),
    },
    {
      key: 'edit',
      label: 'แก้ไข',
      render: (s: Supplier) =>
        isManager ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(s);
            }}
            className="text-primary-600 hover:text-primary-700 text-sm font-medium hover:underline"
          >
            แก้ไข
          </button>
        ) : null,
    },
    {
      key: 'toggle',
      label: 'เปิด/ปิดการใช้งาน',
      render: (s: Supplier) =>
        isManager ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const action = s.isActive ? 'ปิด' : 'เปิด';
              if (confirm(`ต้องการ${action}ใช้งาน Supplier "${s.name}" ?`)) {
                toggleActiveMutation.mutate({ id: s.id, isActive: !s.isActive });
              }
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              s.isActive ? 'bg-green-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                s.isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        ) : (
          <span className="text-xs text-gray-400">{s.isActive ? 'เปิด' : 'ปิด'}</span>
        ),
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
          placeholder="ค้นหาชื่อ, ผู้ติดต่อ, ชื่อเล่น, เบอร์โทร, Tax ID..."
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
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ - นามสกุล (ผู้ติดต่อ) *</label>
              <input
                type="text"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อเล่น</label>
              <input
                type="text"
                value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์โทรศัพท์ *</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
                placeholder="0XX-XXX-XXXX"
                maxLength={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์โทรสำรอง</label>
              <input
                type="text"
                value={form.phoneSecondary}
                onChange={(e) => setForm({ ...form, phoneSecondary: formatPhone(e.target.value) })}
                placeholder="0XX-XXX-XXXX"
                maxLength={12}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">เลขประจำตัวผู้เสียภาษี (Tax ID Number)</label>
              <input
                type="text"
                value={form.taxId}
                onChange={(e) => setForm({ ...form, taxId: formatTaxId(e.target.value) })}
                placeholder="X-XXXX-XXXXX-XX-X"
                maxLength={17}
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

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

interface PaymentMethod {
  id?: string;
  paymentMethod: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  creditTermDays: string | number;
  isDefault: boolean;
}

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
  hasVat: boolean;
  paymentMethods: PaymentMethod[];
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
  hasVat: false,
  notes: '',
};

const emptyPaymentMethod: PaymentMethod = {
  paymentMethod: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  creditTermDays: '',
  isDefault: false,
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  CHECK: 'เช็ค',
  CREDIT: 'เครดิต',
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
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
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
    mutationFn: async ({ formData, addressData, pmList, editId }: { formData: typeof emptyForm; addressData: AddressData; pmList: PaymentMethod[]; editId?: string }) => {
      const serializedAddress = serializeAddress(addressData);
      const validPaymentMethods = pmList
        .filter((pm) => pm.paymentMethod !== '')
        .map((pm) => ({
          paymentMethod: pm.paymentMethod,
          bankName: pm.bankName || undefined,
          bankAccountName: pm.bankAccountName || undefined,
          bankAccountNumber: pm.bankAccountNumber || undefined,
          creditTermDays: pm.creditTermDays ? Number(pm.creditTermDays) : undefined,
          isDefault: pm.isDefault,
        }));

      const payload = {
        name: formData.name,
        contactName: formData.contactName,
        nickname: formData.nickname || undefined,
        phone: formData.phone,
        phoneSecondary: formData.phoneSecondary || undefined,
        lineId: formData.lineId || undefined,
        address: serializedAddress || undefined,
        taxId: formData.taxId || undefined,
        hasVat: formData.hasVat,
        notes: formData.notes || undefined,
        paymentMethods: validPaymentMethods,
      };
      if (editId) {
        return api.patch(`/suppliers/${editId}`, payload);
      }
      return api.post('/suppliers', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(editingSupplier ? 'แก้ไขผู้ขายสำเร็จ' : 'สร้างผู้ขายสำเร็จ');
      closeModal();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const _deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.delete(`/suppliers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('ปิดใช้งานผู้ขายสำเร็จ');
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
      toast.success(variables.isActive ? 'เปิดใช้งานผู้ขายสำเร็จ' : 'ปิดใช้งานผู้ขายสำเร็จ');
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const openCreate = () => {
    setEditingSupplier(null);
    setForm(emptyForm);
    setPaymentMethods([]);
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
      hasVat: supplier.hasVat ?? false,
      notes: supplier.notes || '',
    });
    setPaymentMethods(
      supplier.paymentMethods?.length
        ? supplier.paymentMethods.map((pm) => ({
            id: pm.id,
            paymentMethod: pm.paymentMethod || '',
            bankName: pm.bankName || '',
            bankAccountName: pm.bankAccountName || '',
            bankAccountNumber: pm.bankAccountNumber || '',
            creditTermDays: pm.creditTermDays ?? '',
            isDefault: pm.isDefault ?? false,
          }))
        : []
    );
    setSupplierAddress(deserializeAddress(supplier.address));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSupplier(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ formData: form, addressData: supplierAddress, pmList: paymentMethods, editId: editingSupplier?.id });
  };

  const addPaymentMethod = () => {
    setPaymentMethods([...paymentMethods, { ...emptyPaymentMethod, isDefault: paymentMethods.length === 0 }]);
  };

  const removePaymentMethod = (index: number) => {
    const updated = paymentMethods.filter((_, i) => i !== index);
    // If removed the default, make the first one default
    if (updated.length > 0 && !updated.some((pm) => pm.isDefault)) {
      updated[0] = { ...updated[0], isDefault: true };
    }
    setPaymentMethods(updated);
  };

  const updatePaymentMethod = (index: number, field: keyof PaymentMethod, value: string | number | boolean) => {
    const updated = paymentMethods.map((pm, i) => {
      if (field === 'isDefault' && value === true) {
        return { ...pm, isDefault: i === index };
      }
      if (i === index) {
        return { ...pm, [field]: value };
      }
      return pm;
    });
    setPaymentMethods(updated);
  };

  const columns = [
    {
      key: 'name',
      label: 'ชื่อผู้ขาย',
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
      key: 'hasVat',
      label: 'VAT',
      render: (s: Supplier) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            s.hasVat ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {s.hasVat ? 'มี VAT' : 'ไม่มี VAT'}
        </span>
      ),
    },
    {
      key: 'paymentMethods',
      label: 'วิธีชำระ',
      render: (s: Supplier) => (
        <div className="space-y-0.5">
          {s.paymentMethods?.length ? (
            s.paymentMethods.map((pm, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-sm">{paymentMethodLabels[pm.paymentMethod] || pm.paymentMethod}</span>
                {pm.isDefault && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1 rounded">หลัก</span>}
                {pm.bankName && <span className="text-xs text-gray-400">({pm.bankName})</span>}
              </div>
            ))
          ) : (
            <span className="text-sm text-gray-400">-</span>
          )}
        </div>
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
              if (confirm(`ต้องการ${action}ใช้งานผู้ขาย "${s.name}" ?`)) {
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
        title="จัดการผู้ขาย"
        subtitle={`ทั้งหมด ${result?.total ?? 0} ราย`}
        action={
          isManager ? (
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              + เพิ่มผู้ขาย
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
        emptyMessage="ไม่พบผู้ขาย"
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
        title={editingSupplier ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขายใหม่'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อผู้ขาย / บริษัท *</label>
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
              <label className="flex items-center gap-3 cursor-pointer">
                <span className="text-sm font-medium text-gray-700">จดทะเบียน VAT</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, hasVat: !form.hasVat })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    form.hasVat ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      form.hasVat ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-sm font-medium ${form.hasVat ? 'text-blue-600' : 'text-gray-400'}`}>
                  {form.hasVat ? 'มี VAT (7%)' : 'ไม่มี VAT'}
                </span>
              </label>
            </div>

            {/* Payment Methods Section */}
            <div className="col-span-2 border-t pt-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">ข้อมูลการชำระเงิน</h3>
                <button
                  type="button"
                  onClick={addPaymentMethod}
                  className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium"
                >
                  + เพิ่มวิธีชำระเงิน
                </button>
              </div>

              {paymentMethods.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-3 bg-gray-50 rounded-lg">ยังไม่มีข้อมูลการชำระเงิน กดปุ่ม "เพิ่มวิธีชำระเงิน" เพื่อเพิ่ม</p>
              )}

              {paymentMethods.map((pm, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500">วิธีที่ {index + 1}</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="defaultPayment"
                          checked={pm.isDefault}
                          onChange={() => updatePaymentMethod(index, 'isDefault', true)}
                          className="text-blue-600"
                        />
                        <span className="text-xs text-gray-500">ค่าเริ่มต้น</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePaymentMethod(index)}
                      className="text-red-400 hover:text-red-600 text-xs font-medium"
                    >
                      ลบ
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">วิธีชำระเงิน *</label>
                      <select
                        value={pm.paymentMethod}
                        onChange={(e) => updatePaymentMethod(index, 'paymentMethod', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                        required
                      >
                        <option value="">-- เลือก --</option>
                        <option value="CASH">เงินสด</option>
                        <option value="BANK_TRANSFER">โอนธนาคาร</option>
                        <option value="CHECK">เช็ค</option>
                        <option value="CREDIT">เครดิต</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">เครดิต (วัน)</label>
                      <input
                        type="number"
                        value={pm.creditTermDays}
                        onChange={(e) => updatePaymentMethod(index, 'creditTermDays', e.target.value)}
                        placeholder="เช่น 30"
                        min={0}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                      />
                    </div>
                    {(pm.paymentMethod === 'BANK_TRANSFER' || pm.paymentMethod === 'CHECK') && (
                      <>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">ธนาคาร</label>
                          <input
                            type="text"
                            value={pm.bankName}
                            onChange={(e) => updatePaymentMethod(index, 'bankName', e.target.value)}
                            placeholder="เช่น กสิกรไทย, กรุงเทพ"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">ชื่อบัญชี</label>
                          <input
                            type="text"
                            value={pm.bankAccountName}
                            onChange={(e) => updatePaymentMethod(index, 'bankAccountName', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-500 mb-1">เลขบัญชี</label>
                          <input
                            type="text"
                            value={pm.bankAccountNumber}
                            onChange={(e) => updatePaymentMethod(index, 'bankAccountNumber', e.target.value)}
                            placeholder="XXX-X-XXXXX-X"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
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

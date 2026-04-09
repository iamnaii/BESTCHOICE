import { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import AddressForm, { AddressData, emptyAddress, serializeAddress, deserializeAddress } from '@/components/ui/AddressForm';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { exportToExcel } from '@/utils/excel.util';
import { Download } from 'lucide-react';

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
  useDocumentTitle('ผู้ขาย');
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
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
  const debouncedSearch = useDebounce(search);

  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  useEffect(() => { setPage(1); }, [debouncedSearch, filterActive]);

  const {
    data: result,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<{ data: Supplier[]; total: number; page: number; totalPages: number }>({
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
        <span className="font-medium text-foreground">{s.name}</span>
      ),
    },
    {
      key: 'contactName',
      label: 'ผู้ติดต่อ',
      render: (s: Supplier) => (
        <div>
          <div className="text-foreground">{s.contactName || '-'}</div>
          {s.nickname && <div className="text-xs text-muted-foreground">({s.nickname})</div>}
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'เบอร์โทร',
      render: (s: Supplier) => (
        <div>
          <div>{s.phone}</div>
          {s.phoneSecondary && <div className="text-xs text-muted-foreground">{s.phoneSecondary}</div>}
        </div>
      ),
    },
    {
      key: 'hasVat',
      label: 'VAT',
      render: (s: Supplier) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            s.hasVat ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'bg-muted text-muted-foreground'
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
                {pm.isDefault && <span className="text-2xs bg-warning/10 text-warning dark:bg-warning/15 px-1 rounded">หลัก</span>}
                {pm.bankName && <span className="text-xs text-muted-foreground">({pm.bankName})</span>}
              </div>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
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
            s.isActive ? 'bg-success/10 text-success dark:bg-success/15' : 'bg-destructive/10 text-destructive dark:bg-destructive/15'
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
          className="text-primary hover:text-primary/90 text-sm font-medium hover:underline"
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
            className="text-primary hover:text-primary/90 text-sm font-medium hover:underline"
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
              setConfirmDialog({ open: true, message: `ต้องการ${action}ใช้งานผู้ขาย "${s.name}" ?`, action: () => toggleActiveMutation.mutate({ id: s.id, isActive: !s.isActive }) });
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              s.isActive ? 'bg-green-500' : 'bg-border'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                s.isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">{s.isActive ? 'เปิด' : 'ปิด'}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="จัดการผู้ขาย"
        subtitle={`ทั้งหมด ${result?.total ?? 0} ราย`}
        action={
          <div className="flex gap-2">
            {suppliers.length > 0 && (
              <button
                onClick={async () => {
                  try {
                    await exportToExcel({
                      columns: [
                        { header: 'ชื่อผู้ขาย', key: 'name', width: 25 },
                        { header: 'เบอร์โทร', key: 'phone', width: 15 },
                        { header: 'อีเมล', key: 'lineId', width: 20 },
                        { header: 'ที่อยู่', key: 'address', width: 30 },
                        { header: 'สถานะ', key: 'status', width: 12 },
                      ],
                      data: suppliers.map((s) => ({
                        name: s.name,
                        phone: s.phone,
                        lineId: s.lineId || '-',
                        address: s.address || '-',
                        status: s.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน',
                      })),
                      sheetName: 'ผู้ขาย',
                      filename: `suppliers_${new Date().toISOString().slice(0, 10)}.xlsx`,
                    });
                    toast.success('ส่งออก Excel สำเร็จ');
                  } catch {
                    toast.error('ไม่สามารถส่งออก Excel ได้');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
              >
                <Download className="size-4" />
                ส่งออก Excel
              </button>
            )}
            {isManager && (
              <button
                onClick={openCreate}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                + เพิ่มผู้ขาย
              </button>
            )}
          </div>
        }
      />

      {/* Search & Filter */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหาชื่อ, ผู้ติดต่อ, ชื่อเล่น, เบอร์โทร, Tax ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        />
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="all">ทั้งหมด</option>
          <option value="true">เปิดใช้งาน</option>
          <option value="false">ปิดใช้งาน</option>
        </select>
      </div>

      <QueryBoundary
        isLoading={isLoading && !result}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายชื่อผู้ขายได้"
      >
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
      </QueryBoundary>

      {/* Create/Edit Modal */}
      {isModalOpen && (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label={editingSupplier ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขายใหม่'}>
        <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between shrink-0">
            <button type="button" onClick={closeModal} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              กลับ
            </button>
            <h2 className="text-lg font-semibold text-foreground">{editingSupplier ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขายใหม่'}</h2>
            <div className="w-16" />
          </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-6 space-y-5 flex-1">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9 12 2l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลผู้ขาย</h3>
                <p className="text-xs text-muted-foreground">ชื่อบริษัท, ผู้ติดต่อ, ภาษี</p>
              </div>
            </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อผู้ขาย / บริษัท <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ - นามสกุล (ผู้ติดต่อ) <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อเล่น</label>
              <input
                type="text"
                value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์โทรศัพท์ <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
                placeholder="0XX-XXX-XXXX"
                maxLength={12}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์โทรสำรอง</label>
              <input
                type="text"
                value={form.phoneSecondary}
                onChange={(e) => setForm({ ...form, phoneSecondary: formatPhone(e.target.value) })}
                placeholder="0XX-XXX-XXXX"
                maxLength={12}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">LINE ID</label>
              <input
                type="text"
                value={form.lineId}
                onChange={(e) => setForm({ ...form, lineId: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">เลขประจำตัวผู้เสียภาษี (Tax ID Number)</label>
              <input
                type="text"
                value={form.taxId}
                onChange={(e) => setForm({ ...form, taxId: formatTaxId(e.target.value) })}
                placeholder="X-XXXX-XXXXX-XX-X"
                maxLength={17}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <span className="text-sm font-medium text-foreground">จดทะเบียน VAT</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, hasVat: !form.hasVat })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    form.hasVat ? 'bg-primary' : 'bg-border'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      form.hasVat ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-sm font-medium ${form.hasVat ? 'text-primary' : 'text-muted-foreground'}`}>
                  {form.hasVat ? 'มี VAT (7%)' : 'ไม่มี VAT'}
                </span>
              </label>
            </div>

          </div>
          </div>

          {/* Payment Methods Section */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/10 text-emerald-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ข้อมูลการชำระเงิน</h3>
                  <p className="text-xs text-muted-foreground">วิธีรับชำระเงินจากผู้ขาย</p>
                </div>
              </div>
              <button
                type="button"
                onClick={addPaymentMethod}
                className="px-3 py-1 text-xs bg-primary/5 dark:bg-primary/10 text-primary rounded-lg hover:bg-primary/15 transition-colors font-medium"
              >
                + เพิ่มวิธีชำระเงิน
              </button>
            </div>

              {paymentMethods.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3 bg-muted rounded-lg">ยังไม่มีข้อมูลการชำระเงิน กดปุ่ม "เพิ่มวิธีชำระเงิน" เพื่อเพิ่ม</p>
              )}

              {paymentMethods.map((pm, index) => (
                <div key={index} className="border border-border rounded-lg p-3 mb-3 bg-muted">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">วิธีที่ {index + 1}</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="defaultPayment"
                          checked={pm.isDefault}
                          onChange={() => updatePaymentMethod(index, 'isDefault', true)}
                          className="text-primary"
                        />
                        <span className="text-xs text-muted-foreground">ค่าเริ่มต้น</span>
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
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วิธีชำระเงิน *</label>
                      <select
                        value={pm.paymentMethod}
                        onChange={(e) => updatePaymentMethod(index, 'paymentMethod', e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เครดิต (วัน)</label>
                      <input
                        type="number"
                        value={pm.creditTermDays}
                        onChange={(e) => updatePaymentMethod(index, 'creditTermDays', e.target.value)}
                        placeholder="เช่น 30"
                        min={0}
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    {(pm.paymentMethod === 'BANK_TRANSFER' || pm.paymentMethod === 'CHECK') && (
                      <>
                        <div>
                          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ธนาคาร</label>
                          <input
                            type="text"
                            value={pm.bankName}
                            onChange={(e) => updatePaymentMethod(index, 'bankName', e.target.value)}
                            placeholder="เช่น กสิกรไทย, กรุงเทพ"
                            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <div>
                          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อบัญชี</label>
                          <input
                            type="text"
                            value={pm.bankAccountName}
                            onChange={(e) => updatePaymentMethod(index, 'bankAccountName', e.target.value)}
                            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เลขบัญชี</label>
                          <input
                            type="text"
                            value={pm.bankAccountNumber}
                            onChange={(e) => updatePaymentMethod(index, 'bankAccountNumber', e.target.value)}
                            placeholder="XXX-X-XXXXX-X"
                            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-violet-500/10 text-violet-500">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ที่อยู่</h3>
                <p className="text-xs text-muted-foreground">ที่อยู่ผู้ขาย</p>
              </div>
            </div>
            <AddressForm value={supplierAddress} onChange={setSupplierAddress} label="" />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-rose-500/10 text-rose-500">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">หมายเหตุ</h3>
                <p className="text-xs text-muted-foreground">ข้อมูลเพิ่มเติม</p>
              </div>
            </div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
          </div>
          </div>
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={closeModal}
              className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
            >
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
        </div>
      </div>
      )}

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        description={confirmDialog.message}
        onConfirm={confirmDialog.action}
      />
    </div>
  );
}

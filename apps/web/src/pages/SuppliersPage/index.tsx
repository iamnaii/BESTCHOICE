import { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { emptyAddress, serializeAddress, deserializeAddress } from '@/components/ui/AddressForm';
import type { AddressData } from '@/components/ui/AddressForm';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { exportToExcel } from '@/utils/excel.util';
import { Download } from 'lucide-react';
import SupplierTable from './components/SupplierTable';
import type { Supplier, PaymentMethod } from './components/SupplierTable';
import SupplierForm, { emptyForm, emptyPaymentMethod } from './components/SupplierForm';
import type { SupplierFormData } from './components/SupplierForm';

export default function SuppliersPage() {
  useDocumentTitle('ผู้ขาย');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormData>(emptyForm);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState<string>('true');
  const [supplierAddress, setSupplierAddress] = useState<AddressData>(emptyAddress);
  const [page, setPage] = useState(1);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    action: () => void;
  }>({ open: false, message: '', action: () => {} });
  const debouncedSearch = useDebounce(search);

  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterActive]);

  const { data: result, isLoading, isError, error, refetch } = useQuery<{
    data: Supplier[];
    total: number;
    page: number;
    totalPages: number;
  }>({
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
    mutationFn: async ({
      formData,
      addressData,
      pmList,
      editId,
    }: {
      formData: SupplierFormData;
      addressData: AddressData;
      pmList: PaymentMethod[];
      editId?: string;
    }) => {
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
        : [],
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
    saveMutation.mutate({
      formData: form,
      addressData: supplierAddress,
      pmList: paymentMethods,
      editId: editingSupplier?.id,
    });
  };

  const handleToggleActive = (supplier: Supplier) => {
    const action = supplier.isActive ? 'ปิด' : 'เปิด';
    setConfirmDialog({
      open: true,
      message: `ต้องการ${action}ใช้งานผู้ขาย "${supplier.name}" ?`,
      action: () =>
        toggleActiveMutation.mutate({ id: supplier.id, isActive: !supplier.isActive }),
    });
  };

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
      <div className="flex gap-3 mb-5">
        <input
          type="text"
          placeholder="ค้นหาชื่อ, ผู้ติดต่อ, ชื่อเล่น, เบอร์โทร, Tax ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        />
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
          <option value="all">ทั้งหมด</option>
          <option value="true">เปิดใช้งาน</option>
          <option value="false">ปิดใช้งาน</option>
        </select>
      </div>

      <SupplierTable
        result={result}
        suppliers={suppliers}
        isLoading={isLoading}
        isError={isError}
        error={error}
        refetch={refetch}
        isManager={isManager}
        onEdit={openEdit}
        onToggleActive={handleToggleActive}
        onPageChange={setPage}
      />

      {isModalOpen && (
        <SupplierForm
          isEditing={!!editingSupplier}
          form={form}
          setForm={setForm}
          paymentMethods={paymentMethods}
          setPaymentMethods={setPaymentMethods}
          supplierAddress={supplierAddress}
          setSupplierAddress={setSupplierAddress}
          isPending={saveMutation.isPending}
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
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

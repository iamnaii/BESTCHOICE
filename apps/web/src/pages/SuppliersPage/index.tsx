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
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Building2, Download, Plus, Search } from 'lucide-react';
import SupplierTable from './components/SupplierTable';
import type { Supplier, PaymentMethod } from './components/SupplierTable';
import SupplierForm, { emptyForm } from './components/SupplierForm';
import type { SupplierFormData } from './components/SupplierForm';

export default function SuppliersPage() {
  useDocumentTitle('ผู้จัดจำหน่าย');
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

  const statusFilters: { value: string; label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'true', label: 'เปิดใช้งาน' },
    { value: 'false', label: 'ปิดใช้งาน' },
  ];

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterActive]);

  const {
    data: result,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<{
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

      const isIndividual = formData.type === 'INDIVIDUAL';
      // For individuals, contactName = person themselves (with title if present)
      const resolvedContactName = isIndividual
        ? [formData.titleName, formData.name].filter(Boolean).join(' ').trim() || formData.name
        : formData.contactName || undefined;

      const payload = {
        type: formData.type,
        name: formData.name,
        titleName: isIndividual ? formData.titleName || undefined : undefined,
        contactName: resolvedContactName,
        contactPhone: isIndividual ? undefined : formData.contactPhone || undefined,
        contactPosition: isIndividual ? undefined : formData.contactPosition || undefined,
        nickname: isIndividual ? formData.nickname || undefined : undefined,
        branchCode: isIndividual ? undefined : formData.branchCode || undefined,
        phone: formData.phone,
        phoneSecondary: formData.phoneSecondary || undefined,
        lineId: formData.lineId || undefined,
        address: serializedAddress || undefined,
        taxId: formData.taxId || undefined,
        hasVat: isIndividual ? false : formData.hasVat,
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
      toast.success(editingSupplier ? 'แก้ไขผู้จัดจำหน่ายสำเร็จ' : 'สร้างผู้จัดจำหน่ายสำเร็จ');
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
      toast.success(
        variables.isActive ? 'เปิดใช้งานผู้จัดจำหน่ายสำเร็จ' : 'ปิดใช้งานผู้จัดจำหน่ายสำเร็จ',
      );
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
      type: supplier.type ?? 'JURISTIC',
      name: supplier.name,
      titleName: supplier.titleName || '',
      contactName: supplier.contactName || '',
      contactPhone: supplier.contactPhone || '',
      contactPosition: supplier.contactPosition || '',
      nickname: supplier.nickname || '',
      branchCode: supplier.branchCode || '',
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

  const handleExport = async () => {
    try {
      await exportToExcel({
        columns: [
          { header: 'ชื่อผู้จัดจำหน่าย', key: 'name', width: 25 },
          { header: 'เบอร์โทร', key: 'phone', width: 15 },
          { header: 'LINE ID', key: 'lineId', width: 20 },
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
        sheetName: 'ผู้จัดจำหน่าย',
        filename: `suppliers_${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
      toast.success('ส่งออก Excel สำเร็จ');
    } catch {
      toast.error('ไม่สามารถส่งออก Excel ได้');
    }
  };

  const handleToggleActive = (supplier: Supplier) => {
    const action = supplier.isActive ? 'ปิด' : 'เปิด';
    setConfirmDialog({
      open: true,
      message: `ต้องการ${action}ใช้งานผู้จัดจำหน่าย "${supplier.name}" ?`,
      action: () => toggleActiveMutation.mutate({ id: supplier.id, isActive: !supplier.isActive }),
    });
  };

  return (
    <div>
      <PageHeader
        title="จัดการผู้จัดจำหน่าย"
        subtitle={`ทั้งหมด ${result?.total ?? 0} ราย`}
        icon={<Building2 className="size-5" />}
        action={
          <div className="flex gap-2">
            {suppliers.length > 0 && (
              <Button variant="outline" size="md" onClick={handleExport}>
                <Download />
                ส่งออก Excel
              </Button>
            )}
            {isManager && (
              <Button variant="primary" size="md" onClick={openCreate}>
                <Plus />
                เพิ่มผู้จัดจำหน่าย
              </Button>
            )}
          </div>
        }
      />

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
        pendingToggleId={
          toggleActiveMutation.isPending ? (toggleActiveMutation.variables?.id ?? null) : null
        }
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder="ค้นหาชื่อ, ผู้ติดต่อ, ชื่อเล่น, เบอร์โทร, Tax ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="ค้นหาผู้จัดจำหน่าย"
                className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
              />
            </div>
            <div
              className="inline-flex w-fit shrink-0 items-center rounded-lg bg-muted p-1"
              role="group"
              aria-label="กรองตามสถานะการใช้งาน"
            >
              {statusFilters.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilterActive(f.value)}
                  aria-pressed={filterActive === f.value}
                  className={cn(
                    'cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                    filterActive === f.value
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        }
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

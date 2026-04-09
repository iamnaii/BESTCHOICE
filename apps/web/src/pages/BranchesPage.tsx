import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import AddressForm, { AddressData, emptyAddress, composeAddress, deserializeAddress } from '@/components/ui/AddressForm';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Branch {
  id: string;
  name: string;
  location: string | null;
  phone: string | null;
  isActive: boolean;
  isMainWarehouse: boolean;
  _count: { users: number; products: number; contracts: number };
}

export default function BranchesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [address, setAddress] = useState<AddressData>(emptyAddress);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const {
    data: branches = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { name: string; phone: string; address: AddressData }) => {
      const location = composeAddress(data.address) || undefined;
      const payload = {
        name: data.name,
        location,
        phone: data.phone || undefined,
      };
      if (editingBranch) {
        return api.patch(`/branches/${editingBranch.id}`, payload);
      }
      return api.post('/branches', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(editingBranch ? 'แก้ไขสาขาสำเร็จ' : 'สร้างสาขาสำเร็จ');
      closeModal();
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  const openCreate = () => {
    setEditingBranch(null);
    setForm({ name: '', phone: '' });
    setAddress(emptyAddress);
    setIsModalOpen(true);
  };

  const openEdit = (branch: Branch) => {
    setEditingBranch(branch);
    setForm({ name: branch.name, phone: branch.phone || '' });
    setAddress(deserializeAddress(branch.location));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingBranch(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...form, address });
  };

  const setMainWarehouseMutation = useMutation({
    mutationFn: async (branchId: string) => api.patch(`/branches/${branchId}`, { isMainWarehouse: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('ตั้งเป็นคลังกลางสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const columns = [
    {
      key: 'name',
      label: 'ชื่อสาขา',
      render: (b: Branch) => (
        <div className="flex items-center gap-2">
          <span>{b.name}</span>
          {b.isMainWarehouse && (
            <span className="px-1.5 py-0.5 bg-primary/10 text-primary dark:bg-primary/15 text-xs rounded-full font-medium">คลังกลาง</span>
          )}
        </div>
      ),
    },
    { key: 'location', label: 'ที่ตั้ง' },
    { key: 'phone', label: 'โทรศัพท์' },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (b: Branch) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            b.isActive ? 'bg-success/10 text-success dark:bg-success/15' : 'bg-destructive/10 text-destructive dark:bg-destructive/15'
          }`}
        >
          {b.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
        </span>
      ),
    },
    {
      key: '_count',
      label: 'ข้อมูล',
      render: (b: Branch) => (
        <div className="text-xs text-muted-foreground">
          {b._count.users} ผู้ใช้ | {b._count.products} สินค้า | {b._count.contracts} สัญญา
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (b: Branch) =>
        user?.role === 'OWNER' ? (
          <div className="flex gap-2">
            <button
              onClick={() => openEdit(b)}
              className="text-primary hover:text-primary/80 text-sm font-medium"
            >
              แก้ไข
            </button>
            {!b.isMainWarehouse && (
              <button
                onClick={() => setConfirmDialog({ open: true, message: `ตั้ง "${b.name}" เป็นคลังกลาง?`, action: () => setMainWarehouseMutation.mutate(b.id) })}
                className="text-primary hover:text-primary/80 text-sm font-medium"
              >
                ตั้งเป็นคลังกลาง
              </button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="จัดการสาขา"
        subtitle={`ทั้งหมด ${branches.length} สาขา`}
        action={
          user?.role === 'OWNER' ? (
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              + เพิ่มสาขา
            </button>
          ) : undefined
        }
      />

      <div className="rounded-xl border border-border/60 overflow-hidden">
        <QueryBoundary
          isLoading={isLoading && branches.length === 0}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดรายชื่อสาขาได้"
        >
          <DataTable columns={columns} data={branches} isLoading={isLoading} />
        </QueryBoundary>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label={editingBranch ? 'แก้ไขสาขา' : 'เพิ่มสาขาใหม่'}>
          <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between shrink-0">
              <button type="button" onClick={closeModal} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                กลับ
              </button>
              <h2 className="text-lg font-semibold text-foreground">{editingBranch ? 'แก้ไขสาขา' : 'เพิ่มสาขาใหม่'}</h2>
              <div className="w-16" />
            </div>
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col">
              <div className="p-6 space-y-5 flex-1">
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">ข้อมูลสาขา</h3>
                      <p className="text-xs text-muted-foreground">ชื่อและเบอร์โทรติดต่อ</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อสาขา <span className="text-destructive">*</span></label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">โทรศัพท์</label>
                      <input
                        type="text"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-orange-500/10 text-orange-500">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">ที่ตั้ง</h3>
                      <p className="text-xs text-muted-foreground">ที่อยู่ของสาขา</p>
                    </div>
                  </div>
                  <AddressForm value={address} onChange={setAddress} label="" />
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

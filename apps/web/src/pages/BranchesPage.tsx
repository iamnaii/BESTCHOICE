import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import AddressForm, { AddressData, emptyAddress, composeAddress, deserializeAddress } from '@/components/ui/AddressForm';

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

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
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
            <span className="px-1.5 py-0.5 bg-primary-100 text-primary-700 text-xs rounded font-medium">คลังกลาง</span>
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
            b.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
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
                onClick={() => {
                  if (confirm(`ตั้ง "${b.name}" เป็นคลังกลาง?`)) {
                    setMainWarehouseMutation.mutate(b.id);
                  }
                }}
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

      <DataTable columns={columns} data={branches} isLoading={isLoading} />

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingBranch ? 'แก้ไขสาขา' : 'เพิ่มสาขาใหม่'}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 lg:gap-7.5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ชื่อสาขา *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              required
            />
          </div>
          <AddressForm value={address} onChange={setAddress} label="ที่ตั้ง" />
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">โทรศัพท์</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

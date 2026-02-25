import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';

interface Branch {
  id: string;
  name: string;
  location: string | null;
  phone: string | null;
  isActive: boolean;
  _count: { users: number; products: number; contracts: number };
}

export default function BranchesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState({ name: '', location: '', phone: '' });

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { name: string; location: string; phone: string }) => {
      if (editingBranch) {
        return api.patch(`/branches/${editingBranch.id}`, data);
      }
      return api.post('/branches', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(editingBranch ? 'แก้ไขสาขาสำเร็จ' : 'สร้างสาขาสำเร็จ');
      closeModal();
    },
    onError: () => {
      toast.error('เกิดข้อผิดพลาด');
    },
  });

  const openCreate = () => {
    setEditingBranch(null);
    setForm({ name: '', location: '', phone: '' });
    setIsModalOpen(true);
  };

  const openEdit = (branch: Branch) => {
    setEditingBranch(branch);
    setForm({ name: branch.name, location: branch.location || '', phone: branch.phone || '' });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingBranch(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const columns = [
    { key: 'name', label: 'ชื่อสาขา' },
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
        <div className="text-xs text-gray-500">
          {b._count.users} ผู้ใช้ | {b._count.products} สินค้า | {b._count.contracts} สัญญา
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (b: Branch) =>
        user?.role === 'OWNER' ? (
          <button
            onClick={() => openEdit(b)}
            className="text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            แก้ไข
          </button>
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
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อสาขา *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ที่ตั้ง</label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">โทรศัพท์</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
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

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
  createdAt: string;
  branch: { id: string; name: string } | null;
}

const roleLabels: Record<string, string> = {
  OWNER: 'เจ้าของร้าน',
  BRANCH_MANAGER: 'ผู้จัดการสาขา',
  SALES: 'พนักงานขาย',
  ACCOUNTANT: 'ฝ่ายบัญชี',
};

const roleColors: Record<string, string> = {
  OWNER: 'bg-primary-100 text-primary-700',
  BRANCH_MANAGER: 'bg-primary-100 text-primary-700',
  SALES: 'bg-green-100 text-green-700',
  ACCOUNTANT: 'bg-orange-100 text-orange-700',
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState({
    email: '', password: '', name: '', role: 'SALES', branchId: '',
  });

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data,
  });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (editingUser) return api.patch(`/users/${editingUser.id}`, data);
      return api.post('/users', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(editingUser ? 'แก้ไขผู้ใช้สำเร็จ' : 'เพิ่มผู้ใช้สำเร็จ');
      closeModal();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('อัพเดทสถานะสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openCreate = () => {
    setEditingUser(null);
    setForm({ email: '', password: '', name: '', role: 'SALES', branchId: '' });
    setIsModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditingUser(u);
    setForm({ email: u.email, password: '', name: u.name, role: u.role, branchId: u.branchId || '' });
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditingUser(null); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Record<string, unknown> = {
      name: form.name,
      role: form.role,
      branchId: form.branchId || undefined,
    };
    if (!editingUser) {
      data.email = form.email;
      data.password = form.password;
    }
    if (form.password) data.password = form.password;
    saveMutation.mutate(data);
  };

  const columns = [
    {
      key: 'name', label: 'ชื่อ',
      render: (u: User) => (
        <div>
          <div className="font-medium text-gray-900">{u.name}</div>
          <div className="text-xs text-gray-500">{u.email}</div>
        </div>
      ),
    },
    {
      key: 'role', label: 'ตำแหน่ง',
      render: (u: User) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[u.role] || 'bg-gray-100 text-gray-700'}`}>
          {roleLabels[u.role] || u.role}
        </span>
      ),
    },
    { key: 'branch', label: 'สาขา', render: (u: User) => u.branch?.name || '-' },
    {
      key: 'isActive', label: 'สถานะ',
      render: (u: User) => (
        <button
          onClick={() => { if (confirm(`ต้องการ${u.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}ผู้ใช้ "${u.name}" หรือไม่?`)) toggleActiveMutation.mutate({ id: u.id, isActive: !u.isActive }); }}
          className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
        >
          {u.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
        </button>
      ),
    },
    {
      key: 'createdAt', label: 'สร้างเมื่อ',
      render: (u: User) => new Date(u.createdAt).toLocaleDateString('th-TH'),
    },
    {
      key: 'actions', label: '',
      render: (u: User) => (
        <button onClick={() => openEdit(u)} className="text-primary-600 hover:text-primary-700 text-sm font-medium">
          แก้ไข
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="จัดการผู้ใช้"
        subtitle={`ทั้งหมด ${users.length} คน`}
        action={
          <button onClick={openCreate} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors">
            + เพิ่มผู้ใช้
          </button>
        }
      />

      <DataTable columns={columns} data={users} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingUser && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">อีเมล *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ-นามสกุล *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editingUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}
            </label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!editingUser} minLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ตำแหน่ง *</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                {Object.entries(roleLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สาขา</label>
              <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                <option value="">ไม่ระบุ (ทุกสาขา)</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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

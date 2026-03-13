import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { compressImageForOcr } from '@/lib/compressImage';
import { Camera, X, CreditCard } from 'lucide-react';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
  employeeId: string | null;
  nickname: string | null;
  phone: string | null;
  lineId: string | null;
  address: string | null;
  avatarUrl: string | null;
  startDate: string | null;
  nationalId: string | null;
  birthDate: string | null;
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

const inputClass = 'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

const emptyForm = {
  email: '', password: '', name: '', role: 'SALES', branchId: '',
  employeeId: '', nickname: '', phone: '', lineId: '', address: '', avatarUrl: '', startDate: '',
  nationalId: '', birthDate: '',
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isReadingCard, setIsReadingCard] = useState(false);

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
    setForm(emptyForm);
    setIsModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditingUser(u);
    setForm({
      email: u.email, password: '', name: u.name, role: u.role, branchId: u.branchId || '',
      employeeId: u.employeeId || '', nickname: u.nickname || '', phone: u.phone || '',
      lineId: u.lineId || '', address: u.address || '', avatarUrl: u.avatarUrl || '',
      startDate: u.startDate ? u.startDate.slice(0, 10) : '',
      nationalId: u.nationalId || '', birthDate: u.birthDate ? u.birthDate.slice(0, 10) : '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditingUser(null); };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageForOcr(file, 200, 0.8);
      setForm((prev) => ({ ...prev, avatarUrl: compressed }));
    } catch {
      toast.error('ไม่สามารถอ่านรูปภาพได้');
    }
    e.target.value = '';
  };

  const handleReadCard = async () => {
    setIsReadingCard(true);
    try {
      const status = await checkCardReaderStatus();
      if (!status) {
        toast.error('ไม่พบเครื่องอ่านบัตร กรุณาตรวจสอบว่าเปิดโปรแกรมอ่านบัตรแล้ว');
        return;
      }
      if (status.status === 'no_reader') {
        toast.error('ไม่พบเครื่องอ่านบัตร กรุณาเสียบเครื่องอ่านบัตร');
        return;
      }
      if (status.status === 'waiting') {
        toast.error('กรุณาเสียบบัตรประชาชนก่อน');
        return;
      }
      const card = await readSmartCard();
      setForm((prev) => ({
        ...prev,
        name: `${card.prefix}${card.firstName} ${card.lastName}`,
        nationalId: card.nationalId,
        birthDate: card.birthDate,
        address: card.address,
      }));
      toast.success('อ่านบัตรประชาชนสำเร็จ');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'อ่านบัตรไม่สำเร็จ');
    } finally {
      setIsReadingCard(false);
    }
  };

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
    if (editingUser) {
      // Send null for empty fields so backend clears them (empty string fails DTO validation)
      data.employeeId = form.employeeId || null;
      data.nickname = form.nickname || null;
      data.phone = form.phone || null;
      data.lineId = form.lineId || null;
      data.address = form.address || null;
      data.avatarUrl = form.avatarUrl || null;
      data.startDate = form.startDate || null;
      data.nationalId = form.nationalId || null;
      data.birthDate = form.birthDate || null;
    } else {
      // Create mode: only send non-empty values
      if (form.employeeId) data.employeeId = form.employeeId;
      if (form.nickname) data.nickname = form.nickname;
      if (form.phone) data.phone = form.phone;
      if (form.lineId) data.lineId = form.lineId;
      if (form.address) data.address = form.address;
      if (form.avatarUrl) data.avatarUrl = form.avatarUrl;
      if (form.startDate) data.startDate = form.startDate;
      if (form.nationalId) data.nationalId = form.nationalId;
      if (form.birthDate) data.birthDate = form.birthDate;
    }
    saveMutation.mutate(data);
  };

  const columns = [
    {
      key: 'name', label: 'ชื่อ',
      render: (u: User) => (
        <div className="flex items-center gap-3">
          {u.avatarUrl ? (
            <img src={u.avatarUrl} alt="" className="size-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
              {u.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-medium text-foreground truncate">
              {u.name}
              {u.nickname && <span className="text-muted-foreground font-normal"> ({u.nickname})</span>}
            </div>
            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
          </div>
        </div>
      ),
    },
    { key: 'employeeId', label: 'รหัสพนง.', render: (u: User) => u.employeeId || '-' },
    {
      key: 'role', label: 'ตำแหน่ง',
      render: (u: User) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[u.role] || 'bg-muted text-foreground'}`}>
          {roleLabels[u.role] || u.role}
        </span>
      ),
    },
    { key: 'branch', label: 'สาขา', render: (u: User) => u.branch?.name || '-' },
    { key: 'phone', label: 'เบอร์โทร', render: (u: User) => u.phone || '-' },
    { key: 'lineId', label: 'LINE ID', render: (u: User) => u.lineId || '-' },
    {
      key: 'startDate', label: 'วันเริ่มงาน',
      render: (u: User) => u.startDate ? new Date(u.startDate).toLocaleDateString('th-TH') : '-',
    },
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
      key: 'actions', label: '',
      render: (u: User) => (
        <button onClick={() => openEdit(u)} className="text-primary hover:text-primary/80 text-sm font-medium">
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
          <button onClick={openCreate} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            + เพิ่มผู้ใช้
          </button>
        }
      />

      <DataTable columns={columns} data={users} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 lg:gap-7.5">
          {/* Avatar upload + Card reader */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                {form.avatarUrl ? (
                  <img src={form.avatarUrl} alt="" className="size-16 rounded-full object-cover" />
                ) : (
                  <div className="size-16 rounded-full bg-muted flex items-center justify-center">
                    <Camera className="size-6 text-muted-foreground" />
                  </div>
                )}
                <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
              </div>
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => avatarInputRef.current?.click()} className="text-sm text-primary hover:text-primary/80 font-medium">
                  {form.avatarUrl ? 'เปลี่ยนรูป' : 'อัพโหลดรูปโปรไฟล์'}
                </button>
                {form.avatarUrl && (
                  <button type="button" onClick={() => setForm((prev) => ({ ...prev, avatarUrl: '' }))} className="text-sm text-red-500 hover:text-red-600 flex items-center gap-1">
                    <X className="size-3" /> ลบรูป
                  </button>
                )}
              </div>
            </div>
            <button type="button" onClick={handleReadCard} disabled={isReadingCard}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
              <CreditCard className="size-4" />
              {isReadingCard ? 'กำลังอ่าน...' : 'อ่านบัตรประชาชน'}
            </button>
          </div>

          {/* Email (create only) */}
          {!editingUser && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">อีเมล *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className={inputClass} />
            </div>
          )}

          {/* Name + Nickname */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ชื่อ-นามสกุล *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ชื่อเล่น</label>
              <input type="text" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="เช่น นุ๊ก, เอ" className={inputClass} />
            </div>
          </div>

          {/* Employee ID + Start Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">รหัสพนักงาน</label>
              <input type="text" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} placeholder="EMP-001" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วันเริ่มงาน</label>
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputClass} />
            </div>
          </div>

          {/* National ID + Birth Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">เลขบัตรประชาชน</label>
              <input type="text" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                placeholder="x-xxxx-xxxxx-xx-x" maxLength={13} pattern="\d{13}" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วันเกิด</label>
              <input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className={inputClass} />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {editingUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}
            </label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!editingUser} minLength={6} className={inputClass} />
          </div>

          {/* Role + Branch */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ตำแหน่ง *</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputClass}>
                {Object.entries(roleLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">สาขา</label>
              <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className={inputClass}>
                <option value="">ไม่ระบุ (ทุกสาขา)</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {/* Contact info section */}
          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-muted-foreground mb-3">ข้อมูลติดต่อ</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">เบอร์โทรศัพท์</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0xx-xxx-xxxx" pattern="0[0-9]{9}" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">LINE ID</label>
                <input type="text" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-foreground mb-1">ที่อยู่</label>
              <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className={inputClass} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">ยกเลิก</button>
            <button type="submit" disabled={saveMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

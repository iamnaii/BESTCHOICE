import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { formatDateShort, formatDateMedium } from '@/utils/formatters';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { compressImageForOcr } from '@/lib/compressImage';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Camera, X, CreditCard, Mail, Copy, Link2, Clock, Users, UserCheck, Shield } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import { useAuth } from '@/contexts/AuthContext';
import ThaiDateInput from '@/components/ui/ThaiDateInput';

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
  FINANCE_MANAGER: 'ผู้จัดการการเงิน',
  SALES: 'พนักงานขาย',
  ACCOUNTANT: 'ฝ่ายบัญชี',
};

const roleColors: Record<string, string> = {
  OWNER: 'bg-primary-100 text-primary-700',
  BRANCH_MANAGER: 'bg-primary-100 text-primary-700',
  FINANCE_MANAGER: 'bg-info/10 text-info dark:bg-info/15',
  SALES: 'bg-success/10 text-success dark:bg-success/15',
  ACCOUNTANT: 'bg-warning/10 text-warning dark:bg-warning/15',
};

const inputClass = 'w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
const labelClass = 'block text-xs font-medium text-foreground mb-1.5';

interface InviteToken {
  id: string;
  email: string;
  role: string;
  branchId: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  branch: { id: string; name: string } | null;
  inviter: { id: string; name: string } | null;
}

function getInviteStatus(invite: InviteToken): { label: string; className: string } {
  if (invite.usedAt) return { label: 'ใช้แล้ว', className: 'bg-success/10 text-success dark:bg-success/15' };
  if (new Date(invite.expiresAt) < new Date()) return { label: 'หมดอายุ', className: 'bg-muted text-muted-foreground' };
  return { label: 'รอลงทะเบียน', className: 'bg-warning/10 text-warning dark:bg-warning/15' };
}

const emptyForm = {
  email: '', password: '', name: '', role: 'SALES', branchId: '',
  employeeId: '', nickname: '', phone: '', lineId: '', address: '', avatarUrl: '', startDate: '',
  nationalId: '', birthDate: '',
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isOwner = currentUser?.role === 'OWNER';
  const [activeTab, setActiveTab] = useState<'users' | 'invites'>('users');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isReadingCard, setIsReadingCard] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  // Invite state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'SALES', branchId: '' });
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  const {
    data: users = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get('/users');
      return Array.isArray(data) ? data : data.data ?? [];
    },
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

  // Invite queries & mutations
  const { data: invitesData, isLoading: invitesLoading } = useQuery<{ data: InviteToken[]; total: number }>({
    queryKey: ['invites'],
    queryFn: async () => (await api.get('/invite?limit=100')).data,
    enabled: isOwner,
  });

  const createInviteMutation = useMutation({
    mutationFn: async (data: { email: string; role: string; branchId?: string }) => {
      const payload: Record<string, string> = { email: data.email, role: data.role };
      if (data.branchId) payload.branchId = data.branchId;
      return api.post('/invite', payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      const inviteUrl = res.data.inviteUrl;
      setLastInviteUrl(inviteUrl);
      toast.success('สร้างคำเชิญสำเร็จ อีเมลถูกส่งแล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/invite/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      toast.success('ยกเลิกคำเชิญสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/invite/${id}/resend`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      toast.success('ส่งคำเชิญซ้ำสำเร็จ อีเมลถูกส่งแล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLastInviteUrl(null);
    createInviteMutation.mutate({
      email: inviteForm.email,
      role: inviteForm.role,
      branchId: inviteForm.branchId || undefined,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('คัดลอกลิงก์แล้ว');
  };

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
      branchId: form.branchId || null,
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
      render: (u: User) => u.startDate ? formatDateShort(u.startDate) : '-',
    },
    {
      key: 'isActive', label: 'สถานะ',
      render: (u: User) => (
        <button
          onClick={() => setConfirmDialog({ open: true, message: `ต้องการ${u.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}ผู้ใช้ "${u.name}" หรือไม่?`, action: () => toggleActiveMutation.mutate({ id: u.id, isActive: !u.isActive }) })}
          className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer ${u.isActive ? 'bg-success/10 text-success dark:bg-success/15' : 'bg-destructive/10 text-destructive dark:bg-destructive/15'}`}
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

  const inviteColumns = [
    { key: 'email', label: 'อีเมล', render: (i: InviteToken) => <span className="font-medium">{i.email}</span> },
    {
      key: 'role', label: 'ตำแหน่ง',
      render: (i: InviteToken) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[i.role] || 'bg-muted text-foreground'}`}>
          {roleLabels[i.role] || i.role}
        </span>
      ),
    },
    { key: 'branch', label: 'สาขา', render: (i: InviteToken) => i.branch?.name || '-' },
    { key: 'inviter', label: 'เชิญโดย', render: (i: InviteToken) => i.inviter?.name || '-' },
    {
      key: 'status', label: 'สถานะ',
      render: (i: InviteToken) => {
        const s = getInviteStatus(i);
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'createdAt', label: 'วันที่สร้าง',
      render: (i: InviteToken) => formatDateMedium(i.createdAt),
    },
    {
      key: 'actions', label: '',
      render: (i: InviteToken) => {
        const status = getInviteStatus(i);
        if (status.label === 'ใช้แล้ว') return null;
        return (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDialog({ open: true, message: `ต้องการส่งคำเชิญซ้ำไปยัง "${i.email}" หรือไม่?`, action: () => resendInviteMutation.mutate(i.id) })}
              disabled={resendInviteMutation.isPending}
              className="text-primary hover:text-primary/80 text-sm font-medium"
            >
              ส่งซ้ำ
            </button>
            {status.label === 'รอลงทะเบียน' && (
              <button
                onClick={() => setConfirmDialog({ open: true, message: `ต้องการยกเลิกคำเชิญ "${i.email}" หรือไม่?`, action: () => revokeInviteMutation.mutate(i.id) })}
                className="text-red-500 hover:text-red-600 text-sm font-medium"
              >
                ยกเลิก
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="จัดการผู้ใช้"
        subtitle={`ทั้งหมด ${users.length} คน`}
        action={
          <div className="flex gap-2">
            {isOwner && (
              <button
                onClick={() => { setInviteForm({ email: '', role: 'SALES', branchId: '' }); setLastInviteUrl(null); setIsInviteModalOpen(true); }}
                className="px-4 py-2 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary/5 transition-colors flex items-center gap-1.5"
              >
                <Mail className="size-4" />
                เชิญผู้ใช้ใหม่
              </button>
            )}
            <button onClick={openCreate} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              + เพิ่มผู้ใช้
            </button>
          </div>
        }
      />

      {/* Tabs (only for OWNER) */}
      {isOwner && (
        <div className="flex gap-1 mb-4 border-b border-border/60">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            ผู้ใช้ ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('invites')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'invites'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Link2 className="size-3.5" />
            คำเชิญ ({invitesData?.total || 0})
          </button>
        </div>
      )}

      {/* User Stats Summary */}
      {activeTab === 'users' && users.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Users className="size-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">{users.length}</div>
                  <div className="text-xs text-muted-foreground">ผู้ใช้ทั้งหมด</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-success">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-success/10">
                  <UserCheck className="size-5 text-success" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">{users.filter(u => u.isActive).length}</div>
                  <div className="text-xs text-muted-foreground">ใช้งานอยู่</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-warning">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-warning/10">
                  <Shield className="size-5 text-warning" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">
                    {(() => {
                      const roleCounts = users.reduce<Record<string, number>>((acc, u) => { acc[u.role] = (acc[u.role] || 0) + 1; return acc; }, {});
                      const topRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0];
                      return topRole ? `${roleLabels[topRole[0]] || topRole[0]}` : '-';
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground">ตำแหน่งที่มีมากที่สุด</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-xl border border-border/60 overflow-hidden">
        {activeTab === 'users' ? (
          <QueryBoundary
            isLoading={isLoading && users.length === 0}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดรายชื่อผู้ใช้ได้"
          >
            <DataTable columns={columns} data={users} isLoading={isLoading} />
          </QueryBoundary>
        ) : (
          <DataTable columns={inviteColumns} data={invitesData?.data || []} isLoading={invitesLoading} />
        )}
      </div>

      {/* Invite Modal */}
      {isInviteModalOpen && (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="เชิญผู้ใช้ใหม่">
        <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between shrink-0">
            <button type="button" onClick={() => setIsInviteModalOpen(false)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              กลับ
            </button>
            <h2 className="text-lg font-semibold text-foreground">เชิญผู้ใช้ใหม่</h2>
            <div className="w-16" />
          </div>
          <div className="flex-1 overflow-y-auto p-6">
        {lastInviteUrl ? (
          <div className="space-y-4">
            <div className="p-3 bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg">
              <p className="text-sm font-medium text-success mb-1">สร้างคำเชิญสำเร็จ!</p>
              <p className="text-xs text-success">อีเมลเชิญถูกส่งแล้ว คุณสามารถคัดลอกลิงก์ด้านล่างเพื่อส่งเองได้</p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={lastInviteUrl}
                className={`${inputClass} text-xs flex-1`}
              />
              <button
                onClick={() => copyToClipboard(lastInviteUrl)}
                className="shrink-0 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center gap-1"
              >
                <Copy className="size-3.5" />
                คัดลอก
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              ลิงก์หมดอายุใน 72 ชั่วโมง
            </div>
          </div>
        ) : (
          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>อีเมล *</label>
              <input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                required
                className={inputClass}
                placeholder="employee@example.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>ตำแหน่ง *</label>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className={inputClass}
                >
                  {Object.entries(roleLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>สาขา</label>
                <select
                  value={inviteForm.branchId}
                  onChange={(e) => setInviteForm({ ...inviteForm, branchId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">ไม่ระบุ (ทุกสาขา)</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
          </form>
        )}
          </div>
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            {lastInviteUrl ? (
              <button type="button" onClick={() => setIsInviteModalOpen(false)} className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold transition-colors shadow-sm">
                ปิด
              </button>
            ) : (
              <>
                <button type="button" onClick={() => setIsInviteModalOpen(false)} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">ยกเลิก</button>
                <button type="button" disabled={createInviteMutation.isPending} onClick={handleInviteSubmit}
                  className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm flex items-center gap-1.5">
                  <Mail className="size-4" />
                  {createInviteMutation.isPending ? 'กำลังส่ง...' : 'ส่งคำเชิญ'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {/* User Create/Edit Modal */}
      {isModalOpen && (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label={editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}>
        <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between shrink-0">
            <button type="button" onClick={closeModal} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              กลับ
            </button>
            <h2 className="text-lg font-semibold text-foreground">{editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}</h2>
            <div className="w-16" />
          </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-6 space-y-5 flex-1">
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
              <label className={labelClass}>อีเมล *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className={inputClass} />
            </div>
          )}

          {/* Name + Nickname */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>ชื่อ-นามสกุล *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>ชื่อเล่น</label>
              <input type="text" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="เช่น นุ๊ก, เอ" className={inputClass} />
            </div>
          </div>

          {/* Employee ID + Start Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>รหัสพนักงาน</label>
              <input type="text" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} placeholder="EMP-001" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>วันเริ่มงาน</label>
              <ThaiDateInput value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputClass} />
            </div>
          </div>

          {/* National ID + Birth Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>เลขบัตรประชาชน</label>
              <input type="text" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                placeholder="x-xxxx-xxxxx-xx-x" maxLength={13} pattern="\d{13}" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>วันเกิด</label>
              <ThaiDateInput value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className={inputClass} />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className={labelClass}>
              {editingUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}
            </label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!editingUser} minLength={6} className={inputClass} />
          </div>

          {/* Role + Branch */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>ตำแหน่ง *</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputClass}>
                {Object.entries(roleLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>สาขา</label>
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
                <label className={labelClass}>เบอร์โทรศัพท์</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0xx-xxx-xxxx" pattern="0[0-9]{9}" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>LINE ID</label>
                <input type="text" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div className="mt-4">
              <label className={labelClass}>ที่อยู่</label>
              <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className={inputClass} />
            </div>
          </div>

          </div>
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button type="button" onClick={closeModal} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">ยกเลิก</button>
            <button type="submit" disabled={saveMutation.isPending}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm">
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

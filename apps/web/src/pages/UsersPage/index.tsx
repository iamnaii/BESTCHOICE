import { useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import PageHeader from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Mail, Link2, Users, UserCheck, Shield } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { User, InviteToken, emptyForm } from './types';
import { UserTable, InviteTable } from './components/UserTable';
import UserForm from './components/UserForm';
import InviteModal from './components/InviteModal';

export default function UsersPage() {
  useDocumentTitle('ผู้ใช้งาน');
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { copy } = useCopyToClipboard();
  const isOwner = currentUser?.role === 'OWNER';

  const [activeTab, setActiveTab] = useState<'users' | 'invites'>('users');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    action: () => void;
  }>({ open: false, message: '', action: () => {} });

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

  const { data: invitesData, isLoading: invitesLoading } = useQuery<{
    data: InviteToken[];
    total: number;
  }>({
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
    copy(text);
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
      email: u.email,
      password: '',
      name: u.name,
      role: u.role,
      branchId: u.branchId || '',
      employeeId: u.employeeId || '',
      nickname: u.nickname || '',
      phone: u.phone || '',
      lineId: u.lineId || '',
      address: u.address || '',
      avatarUrl: u.avatarUrl || '',
      startDate: u.startDate ? u.startDate.slice(0, 10) : '',
      nationalId: u.nationalId || '',
      birthDate: u.birthDate ? u.birthDate.slice(0, 10) : '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
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

  const handleToggleActive = (id: string, isActive: boolean, name: string) => {
    setConfirmDialog({
      open: true,
      message: `ต้องการ${isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}ผู้ใช้ "${name}" หรือไม่?`,
      action: () => toggleActiveMutation.mutate({ id, isActive: !isActive }),
    });
  };

  const handleBulkDeactivate = (selected: User[]) => {
    const active = selected.filter((u) => u.isActive);
    if (active.length === 0) {
      toast.error('ไม่มีผู้ใช้ที่ใช้งานอยู่ในรายการที่เลือก');
      return;
    }
    setConfirmDialog({
      open: true,
      message: `ต้องการปิดใช้งานผู้ใช้ ${active.length} คนที่เลือกหรือไม่?`,
      action: () => {
        active.forEach((u) => toggleActiveMutation.mutate({ id: u.id, isActive: false }));
      },
    });
  };

  const handleResendInvite = (id: string, email: string) => {
    setConfirmDialog({
      open: true,
      message: `ต้องการส่งคำเชิญซ้ำไปยัง "${email}" หรือไม่?`,
      action: () => resendInviteMutation.mutate(id),
    });
  };

  const handleRevokeInvite = (id: string, email: string) => {
    setConfirmDialog({
      open: true,
      message: `ต้องการยกเลิกคำเชิญ "${email}" หรือไม่?`,
      action: () => revokeInviteMutation.mutate(id),
    });
  };

  return (
    <div>
      <PageHeader
        title="จัดการผู้ใช้"
        subtitle={`ทั้งหมด ${users.length} คน`}
        action={
          <div className="flex gap-2">
            {isOwner && (
              <button
                onClick={() => {
                  setInviteForm({ email: '', role: 'SALES', branchId: '' });
                  setLastInviteUrl(null);
                  setIsInviteModalOpen(true);
                }}
                className="px-4 py-2 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary/5 transition-colors flex items-center gap-1.5"
              >
                <Mail className="size-4" />
                เชิญผู้ใช้ใหม่
              </button>
            )}
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
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
          <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full">
              <div className="w-1 shrink-0 bg-primary" />
              <CardContent className="p-5 flex-1">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Users className="size-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold tabular-nums text-foreground">
                      {users.length}
                    </div>
                    <div className="text-xs text-muted-foreground">ผู้ใช้ทั้งหมด</div>
                  </div>
                </div>
              </CardContent>
            </div>
          </Card>
          <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full">
              <div className="w-1 shrink-0 bg-success" />
              <CardContent className="p-5 flex-1">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-success/10">
                    <UserCheck className="size-5 text-success" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold tabular-nums text-foreground">
                      {users.filter((u) => u.isActive).length}
                    </div>
                    <div className="text-xs text-muted-foreground">ใช้งานอยู่</div>
                  </div>
                </div>
              </CardContent>
            </div>
          </Card>
          {(() => {
            const ownerCount = users.filter((u) => u.role === 'OWNER' && u.isActive).length;
            const tooMany = ownerCount > 2;
            return (
              <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
                <div className="flex h-full">
                  <div className={`w-1 shrink-0 ${tooMany ? 'bg-destructive' : 'bg-warning'}`} />
                  <CardContent className="p-5 flex-1">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${tooMany ? 'bg-destructive/10' : 'bg-warning/10'}`}>
                        <Shield className={`size-5 ${tooMany ? 'text-destructive' : 'text-warning'}`} />
                      </div>
                      <div>
                        <div className="text-2xl font-bold tabular-nums text-foreground">
                          {ownerCount}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {tooMany ? 'เจ้าของร้าน (ควรมีไม่เกิน 2 คน)' : 'เจ้าของร้าน'}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </div>
              </Card>
            );
          })()}
        </div>
      )}

      {activeTab === 'users' ? (
        <UserTable
          users={users}
          branches={branches}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          onEdit={openEdit}
          onToggleActive={handleToggleActive}
          onBulkDeactivate={handleBulkDeactivate}
        />
      ) : (
        <InviteTable
          invites={invitesData?.data || []}
          isLoading={invitesLoading}
          onResend={handleResendInvite}
          onRevoke={handleRevokeInvite}
          isResendPending={resendInviteMutation.isPending}
        />
      )}

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <InviteModal
          inviteForm={inviteForm}
          setInviteForm={setInviteForm}
          lastInviteUrl={lastInviteUrl}
          isPending={createInviteMutation.isPending}
          branches={branches}
          onClose={() => setIsInviteModalOpen(false)}
          onSubmit={handleInviteSubmit}
          onCopyUrl={copyToClipboard}
        />
      )}

      {/* User Create/Edit Modal */}
      {isModalOpen && (
        <UserForm
          editingUser={editingUser}
          form={form}
          setForm={setForm}
          isSaving={saveMutation.isPending}
          branches={branches}
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

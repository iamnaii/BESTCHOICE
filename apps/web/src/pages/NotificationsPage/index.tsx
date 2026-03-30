import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

import { NotificationLog, NotificationTemplate, LogStats } from './types';
import NotificationLogsTab from './NotificationLogsTab';
import NotificationTemplatesTab from './NotificationTemplatesTab';
import SendNotificationTab from './SendNotificationTab';
import TemplateModal from './TemplateModal';

type Tab = 'logs' | 'templates' | 'send';

const TAB_BTN = (active: boolean) =>
  `px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
    active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
  }`;

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('logs');
  const [channelFilter, setChannelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);

  // ─── Queries ─────────────────────────────────────────
  const { data: logs = [], isLoading: logsLoading } = useQuery<NotificationLog[]>({
    queryKey: ['notification-logs', channelFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (channelFilter) params.set('channel', channelFilter);
      if (statusFilter) params.set('status', statusFilter);
      return (await api.get(`/notifications/logs?${params}`)).data;
    },
    enabled: activeTab === 'logs',
  });

  const { data: stats } = useQuery<LogStats>({
    queryKey: ['notification-stats'],
    queryFn: async () => (await api.get('/notifications/logs/stats')).data,
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery<NotificationTemplate[]>({
    queryKey: ['notification-templates'],
    queryFn: async () => (await api.get('/notifications/templates')).data,
    enabled: activeTab === 'templates',
  });

  // ─── Mutations ───────────────────────────────────────
  const saveTemplateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      editingTemplate
        ? api.patch(`/notifications/templates/${editingTemplate.id}`, data)
        : api.post('/notifications/templates', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      toast.success(editingTemplate ? 'อัพเดท template สำเร็จ' : 'สร้าง template สำเร็จ');
      setIsTemplateModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/notifications/templates/${id}`),
    onSuccess: () => {
      toast.success('ลบเทมเพลตสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const sendNotificationMutation = useMutation({
    mutationFn: (data: { customerId: string; channel: string; subject: string; message: string }) =>
      api.post('/notifications/send', data),
    onSuccess: () => {
      toast.success('ส่งการแจ้งเตือนสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const sendRemindersMutation = useMutation({
    mutationFn: async () => api.post('/notifications/cron/payment-reminders'),
    onSuccess: (res) => {
      toast.success(`ส่งเตือนแล้ว ${res.data.sent} รายการ`);
      queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const sendOverdueMutation = useMutation({
    mutationFn: async () => api.post('/notifications/cron/overdue-notices'),
    onSuccess: (res) => {
      toast.success(`ส่งทวงหนี้แล้ว ${res.data.sent} รายการ`);
      queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // ─── Handlers ────────────────────────────────────────
  const openCreateTemplate = () => { setEditingTemplate(null); setIsTemplateModalOpen(true); };
  const openEditTemplate = (t: NotificationTemplate) => { setEditingTemplate(t); setIsTemplateModalOpen(true); };

  return (
    <div>
      <PageHeader title="แจ้งเตือน" subtitle="ระบบแจ้งเตือน LINE / SMS" />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'ทั้งหมด', value: stats.total, cls: '' },
            { label: 'ส่งสำเร็จ', value: stats.sent, cls: 'text-green-600' },
            { label: 'ล้มเหลว', value: stats.failed, cls: 'text-red-600' },
            { label: 'รอส่ง', value: stats.pending, cls: 'text-yellow-600' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-card rounded-lg border border-border p-4">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className={`text-2xl font-bold ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => sendRemindersMutation.mutate()}
          disabled={sendRemindersMutation.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {sendRemindersMutation.isPending ? 'กำลังส่ง...' : 'ส่งเตือนก่อนครบกำหนด'}
        </button>
        <button
          onClick={() => sendOverdueMutation.mutate()}
          disabled={sendOverdueMutation.isPending}
          className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
        >
          {sendOverdueMutation.isPending ? 'กำลังส่ง...' : 'ส่งทวงหนี้ค้างชำระ'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        <button onClick={() => setActiveTab('logs')} className={TAB_BTN(activeTab === 'logs')}>ประวัติการส่ง</button>
        <button onClick={() => setActiveTab('templates')} className={TAB_BTN(activeTab === 'templates')}>Template ข้อความ</button>
        <button onClick={() => setActiveTab('send')} className={TAB_BTN(activeTab === 'send')}>ส่งการแจ้งเตือน</button>
      </div>

      {activeTab === 'logs' && (
        <NotificationLogsTab
          logs={logs}
          isLoading={logsLoading}
          channelFilter={channelFilter}
          statusFilter={statusFilter}
          onChannelFilterChange={setChannelFilter}
          onStatusFilterChange={setStatusFilter}
        />
      )}

      {activeTab === 'templates' && (
        <NotificationTemplatesTab
          templates={templates}
          isLoading={templatesLoading}
          onCreateTemplate={openCreateTemplate}
          onEditTemplate={openEditTemplate}
          onDeleteTemplate={(id) => deleteTemplateMutation.mutate(id)}
          isDeletingTemplate={deleteTemplateMutation.isPending}
        />
      )}

      {activeTab === 'send' && (
        <SendNotificationTab
          onSend={sendNotificationMutation.mutate}
          isSending={sendNotificationMutation.isPending}
        />
      )}

      <TemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        editingTemplate={editingTemplate}
        onSave={saveTemplateMutation.mutate}
        isSaving={saveTemplateMutation.isPending}
      />
    </div>
  );
}

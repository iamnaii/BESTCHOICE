import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import NotificationLogTable from './components/NotificationLogTable';
import TemplateManager from './components/TemplateManager';
import TemplateForm, { type TemplateFormState } from './components/TemplateForm';

interface NotificationTemplate {
  id: string;
  name: string;
  eventType: string;
  channel: string;
  format?: string;
  subject: string | null;
  messageTemplate: string;
  flexTemplate?: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

interface PerChannelStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
}

interface LogStats {
  line: PerChannelStats;
  sms: PerChannelStats & { creditRemaining: number };
  in_app: PerChannelStats;
}

const defaultTemplateForm: TemplateFormState = {
  name: '',
  eventType: 'PAYMENT_REMINDER',
  channel: 'LINE',
  format: 'text',
  subject: '',
  messageTemplate: '',
  flexTemplate: '',
  description: '',
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'logs' | 'templates' | 'send'>('logs');
  const [channelFilter, setChannelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(defaultTemplateForm);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [sendForm, setSendForm] = useState({
    customerId: '',
    channel: 'LINE',
    subject: '',
    message: '',
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    action: () => void;
  }>({ open: false, message: '', action: () => {} });

  const { data: stats, isLoading: statsLoading, isError: statsError, error: statsErrorObj, refetch: refetchStats } = useQuery<LogStats>({
    queryKey: ['notification-stats'],
    queryFn: async () => (await api.get('/notifications/logs/stats')).data,
  });

  const sendNotificationMutation = useMutation({
    mutationFn: async (data: {
      customerId: string;
      channel: string;
      subject: string;
      message: string;
    }) => api.post('/notifications/send', data),
    onSuccess: () => {
      toast.success('ส่งการแจ้งเตือนสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
      setSendForm({ customerId: '', channel: 'LINE', subject: '', message: '' });
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

  const openCreateTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm(defaultTemplateForm);
    setJsonError(null);
    setIsTemplateModalOpen(true);
  };

  const openEditTemplate = (t: NotificationTemplate) => {
    setEditingTemplate(t);
    setTemplateForm({
      name: t.name,
      eventType: t.eventType,
      channel: t.channel,
      format: (t.format as 'text' | 'flex') || 'text',
      subject: t.subject || '',
      messageTemplate: t.messageTemplate,
      flexTemplate: t.flexTemplate || '',
      description: t.description || '',
    });
    setJsonError(null);
    setIsTemplateModalOpen(true);
  };

  const handleConfirmDelete = (message: string, action: () => void) => {
    setConfirmDialog({ open: true, message, action });
  };

  return (
    <div>
      <PageHeader title="แจ้งเตือน" subtitle="ระบบแจ้งเตือน LINE / SMS" />

      {/* Stats */}
      <QueryBoundary
        isLoading={statsLoading}
        isError={statsError}
        error={statsErrorObj}
        onRetry={refetchStats}
        errorTitle="ไม่สามารถโหลดสถิติการแจ้งเตือนได้"
      >
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="text-sm text-muted-foreground">LINE (7 วันล่าสุด)</div>
            <div className="text-2xl font-bold tabular-nums">
              {stats.line.sent} / {stats.line.total}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.line.failed} ล้มเหลว, {stats.line.pending} รอส่ง
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="text-sm text-muted-foreground">SMS (7 วันล่าสุด)</div>
            <div className="text-2xl font-bold tabular-nums">
              {stats.sms.sent} / {stats.sms.total}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              เครดิต: {stats.sms.creditRemaining}
              {stats.sms.creditRemaining > 0 && stats.sms.creditRemaining < 100 && (
                <span className="text-destructive"> (ใกล้หมด)</span>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="text-sm text-muted-foreground">IN_APP (7 วันล่าสุด)</div>
            <div className="text-2xl font-bold tabular-nums">
              {stats.in_app.sent} / {stats.in_app.total}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.in_app.failed} ล้มเหลว
            </div>
          </div>
        </div>
      )}

      </QueryBoundary>

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
          className="px-4 py-2 bg-warning text-warning-foreground rounded-lg text-sm font-medium hover:bg-warning/90 disabled:opacity-50"
        >
          {sendOverdueMutation.isPending ? 'กำลังส่ง...' : 'ส่งทวงหนี้ค้างชำระ'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === 'logs' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ประวัติการส่ง
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === 'templates' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Template ข้อความ
        </button>
        <button
          onClick={() => setActiveTab('send')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === 'send' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ส่งการแจ้งเตือน
        </button>
      </div>

      {activeTab === 'logs' && (
        <NotificationLogTable
          channelFilter={channelFilter}
          setChannelFilter={setChannelFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          activeTab={activeTab}
        />
      )}

      {activeTab === 'templates' && (
        <TemplateManager
          activeTab={activeTab}
          onCreateTemplate={openCreateTemplate}
          onEditTemplate={openEditTemplate}
          onConfirmDelete={handleConfirmDelete}
        />
      )}

      {activeTab === 'send' && (
        <div className="rounded-xl border border-border/50 bg-card shadow-sm p-6 max-w-lg">
          <h3 className="text-lg font-semibold mb-4">ส่งการแจ้งเตือนด้วยตนเอง</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendNotificationMutation.mutate(sendForm);
            }}
            className="flex flex-col gap-4"
          >
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Customer ID *
              </label>
              <input
                type="text"
                value={sendForm.customerId}
                onChange={(e) => setSendForm({ ...sendForm, customerId: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                placeholder="รหัสลูกค้า"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ช่องทาง *</label>
              <select
                value={sendForm.channel}
                onChange={(e) => setSendForm({ ...sendForm, channel: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
              >
                <option value="LINE">LINE</option>
                <option value="SMS">SMS</option>
                <option value="IN_APP">ในระบบ (IN_APP)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หัวข้อ</label>
              <input
                type="text"
                value={sendForm.subject}
                onChange={(e) => setSendForm({ ...sendForm, subject: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                placeholder="หัวข้อการแจ้งเตือน"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ข้อความ *</label>
              <textarea
                value={sendForm.message}
                onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                placeholder="เนื้อหาข้อความแจ้งเตือน"
                required
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={sendNotificationMutation.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {sendNotificationMutation.isPending ? 'กำลังส่ง...' : 'ส่งการแจ้งเตือน'}
              </button>
            </div>
          </form>
        </div>
      )}

      <TemplateForm
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        editingTemplate={editingTemplate}
        templateForm={templateForm}
        setTemplateForm={setTemplateForm}
        jsonError={jsonError}
        setJsonError={setJsonError}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        description={confirmDialog.message}
        variant="destructive"
        onConfirm={confirmDialog.action}
      />
    </div>
  );
}

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
import StaffNotifyTab from './components/StaffNotifyTab';
import { useAuth } from '@/contexts/AuthContext';

interface NotificationTemplate {
  id: string;
  eventType: string;
  name: string;
  category?: string;
  channelKey?: string | null;
  channel: string;
  format?: string;
  subject: string | null;
  messageTemplate: string;
  flexTemplate?: string;
  description: string | null;
  isActive: boolean;
  sampleData?: Record<string, unknown> | null;
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
  eventType: '',
  name: '',
  category: 'DUNNING',
  channelKey: 'line-finance',
  channel: 'LINE',
  format: 'text',
  subject: '',
  messageTemplate: '',
  flexTemplate: '',
  description: '',
  isActive: true,
  sampleData: '',
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [activeTab, setActiveTab] = useState<'logs' | 'templates' | 'staff'>('logs');
  const [channelFilter, setChannelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(defaultTemplateForm);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    action: () => void;
  }>({ open: false, message: '', action: () => {} });

  const { data: stats, isLoading: statsLoading, isError: statsError, error: statsErrorObj, refetch: refetchStats } = useQuery<LogStats>({
    queryKey: ['notification-stats'],
    queryFn: async () => (await api.get('/notifications/logs/stats')).data,
  });

  const { data: complianceStats } = useQuery<Record<string, number>>({
    queryKey: ['notification-compliance-stats'],
    queryFn: async () => (await api.get('/notifications/compliance/stats')).data,
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
      eventType: t.eventType,
      name: t.name,
      category: t.category || 'DUNNING',
      channelKey: t.channelKey ?? null,
      channel: t.channel,
      format: (t.format as 'text' | 'flex') || 'text',
      subject: t.subject || '',
      messageTemplate: t.messageTemplate,
      flexTemplate: t.flexTemplate || '',
      description: t.description || '',
      isActive: t.isActive,
      sampleData: t.sampleData ? JSON.stringify(t.sampleData, null, 2) : '',
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

      {/* Compliance block-rate (last 7 days) */}
      {complianceStats && Object.values(complianceStats).some((n) => n > 0) && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 mb-6">
          <div className="text-sm text-muted-foreground mb-2">
            Compliance blocks (7 วันล่าสุด)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 text-sm">
            <div>
              นอกเวลา:{' '}
              <span className="font-semibold tabular-nums">
                {complianceStats.OUTSIDE_HOURS}
              </span>
            </div>
            <div>
              เกินจำนวนครั้ง:{' '}
              <span className="font-semibold tabular-nums">
                {complianceStats.FREQUENCY_CAP}
              </span>
            </div>
            <div>
              ไม่มี PDPA:{' '}
              <span className="font-semibold tabular-nums">
                {complianceStats.NO_CONSENT}
              </span>
            </div>
            <div>
              วันหยุด:{' '}
              <span className="font-semibold tabular-nums">
                {complianceStats.HOLIDAY_BLOCK}
              </span>
            </div>
            {/* Task 30 — ข้อความทวงที่ระบบส่งเองถูกระงับช่วงผ่อนผันหลังผูก LINE ของสัญญานำเข้า (API คีย์ LEGACY_LINK_GRACE) */}
            <div>
              ผ่อนผัน 7 วัน (ลูกค้าเก่า):{' '}
              <span className="font-semibold tabular-nums">
                {complianceStats.LEGACY_LINK_GRACE ?? 0}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-x-3 gap-y-2 mb-6">
        <button data-ui-control="button"
          onClick={() => sendRemindersMutation.mutate()}
          disabled={sendRemindersMutation.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium whitespace-nowrap hover:bg-primary/90 disabled:opacity-50"
        >
          {sendRemindersMutation.isPending ? 'กำลังส่ง...' : 'ส่งเตือนก่อนครบกำหนด'}
        </button>
        <button data-ui-control="button"
          onClick={() => sendOverdueMutation.mutate()}
          disabled={sendOverdueMutation.isPending}
          className="px-4 py-2 bg-warning text-warning-foreground rounded-lg text-sm font-medium whitespace-nowrap hover:bg-warning/90 disabled:opacity-50"
        >
          {sendOverdueMutation.isPending ? 'กำลังส่ง...' : 'ส่งทวงหนี้ค้างชำระ'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex max-w-full min-w-0 overflow-x-auto overflow-y-hidden gap-1 mb-4 shadow-[inset_0_-1px_0_hsl(var(--border))]">
        <button data-ui-control="button"
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 ${activeTab === 'logs' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ประวัติการส่ง
        </button>
        <button data-ui-control="button"
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 ${activeTab === 'templates' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          แม่แบบข้อความ
        </button>
        {isOwner && (
          <button data-ui-control="button"
            onClick={() => setActiveTab('staff')}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 ${activeTab === 'staff' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            แจ้งพนักงาน (LINE)
          </button>
        )}
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

      {activeTab === 'staff' && isOwner && <StaffNotifyTab />}

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

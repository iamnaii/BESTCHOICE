import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface NotificationLog {
  id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  message: string;
  status: string;
  relatedId: string | null;
  errorMsg: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface NotificationTemplate {
  id: string;
  name: string;
  eventType: string;
  channel: string;
  subject: string | null;
  messageTemplate: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

interface LogStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
}

const channelLabels: Record<string, string> = {
  LINE: 'LINE',
  SMS: 'SMS',
  IN_APP: 'ในระบบ',
};

const statusLabels: Record<string, string> = {
  SENT: 'ส่งแล้ว',
  FAILED: 'ล้มเหลว',
  PENDING: 'รอส่ง',
};

const statusColors: Record<string, string> = {
  SENT: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
};

const eventTypeLabels: Record<string, string> = {
  PAYMENT_REMINDER: 'เตือนชำระ',
  OVERDUE_NOTICE: 'ทวงหนี้',
  PAYMENT_SUCCESS: 'ชำระสำเร็จ',
  CONTRACT_DEFAULT: 'ผิดนัด',
};

const placeholdersList = [
  '{customer_name}', '{contract_number}', '{amount}', '{due_date}',
  '{installment_no}', '{late_fee}', '{branch_name}', '{overdue_days}',
];

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'logs' | 'templates'>('logs');
  const [channelFilter, setChannelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    eventType: 'PAYMENT_REMINDER',
    channel: 'LINE',
    subject: '',
    messageTemplate: '',
    description: '',
  });

  // Logs
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

  // Templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery<NotificationTemplate[]>({
    queryKey: ['notification-templates'],
    queryFn: async () => (await api.get('/notifications/templates')).data,
    enabled: activeTab === 'templates',
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (editingTemplate) {
        return api.patch(`/notifications/templates/${editingTemplate.id}`, data);
      }
      return api.post('/notifications/templates', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      toast.success(editingTemplate ? 'อัพเดท template สำเร็จ' : 'สร้าง template สำเร็จ');
      setIsTemplateModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Cron actions
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
    setTemplateForm({
      name: '',
      eventType: 'PAYMENT_REMINDER',
      channel: 'LINE',
      subject: '',
      messageTemplate: '',
      description: '',
    });
    setIsTemplateModalOpen(true);
  };

  const openEditTemplate = (t: NotificationTemplate) => {
    setEditingTemplate(t);
    setTemplateForm({
      name: t.name,
      eventType: t.eventType,
      channel: t.channel,
      subject: t.subject || '',
      messageTemplate: t.messageTemplate,
      description: t.description || '',
    });
    setIsTemplateModalOpen(true);
  };

  const handleTemplateSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveTemplateMutation.mutate(templateForm);
  };

  const logColumns = [
    {
      key: 'channel',
      label: 'ช่องทาง',
      render: (l: NotificationLog) => (
        <span className="text-sm font-medium">{channelLabels[l.channel] || l.channel}</span>
      ),
    },
    {
      key: 'recipient',
      label: 'ผู้รับ',
      render: (l: NotificationLog) => <span className="text-sm">{l.recipient}</span>,
    },
    {
      key: 'message',
      label: 'ข้อความ',
      render: (l: NotificationLog) => (
        <div className="max-w-xs truncate text-sm text-gray-600">{l.message}</div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (l: NotificationLog) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[l.status]}`}>
          {statusLabels[l.status]}
        </span>
      ),
    },
    {
      key: 'sentAt',
      label: 'เวลาส่ง',
      render: (l: NotificationLog) => (
        <span className="text-xs text-gray-500">
          {l.sentAt ? new Date(l.sentAt).toLocaleString('th-TH') : '-'}
        </span>
      ),
    },
  ];

  const templateColumns = [
    { key: 'name', label: 'ชื่อ Template' },
    {
      key: 'eventType',
      label: 'ประเภท',
      render: (t: NotificationTemplate) => (
        <span className="text-sm">{eventTypeLabels[t.eventType] || t.eventType}</span>
      ),
    },
    {
      key: 'channel',
      label: 'ช่องทาง',
      render: (t: NotificationTemplate) => (
        <span className="text-sm font-medium">{channelLabels[t.channel]}</span>
      ),
    },
    {
      key: 'messageTemplate',
      label: 'ข้อความ',
      render: (t: NotificationTemplate) => (
        <div className="max-w-xs truncate text-sm text-gray-600">{t.messageTemplate}</div>
      ),
    },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (t: NotificationTemplate) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {t.isActive ? 'เปิดใช้งาน' : 'ปิด'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (t: NotificationTemplate) => (
        <button
          onClick={() => openEditTemplate(t)}
          className="text-primary-600 hover:text-primary-700 text-sm font-medium"
        >
          แก้ไข
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="แจ้งเตือน" subtitle="ระบบแจ้งเตือน LINE / SMS" />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ทั้งหมด</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ส่งสำเร็จ</div>
            <div className="text-2xl font-bold text-green-600">{stats.sent}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ล้มเหลว</div>
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">รอส่ง</div>
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => sendRemindersMutation.mutate()}
          disabled={sendRemindersMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
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
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === 'logs' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          ประวัติการส่ง
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === 'templates' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Template ข้อความ
        </button>
      </div>

      {activeTab === 'logs' && (
        <>
          <div className="flex gap-3 mb-4">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            >
              <option value="">ทุกช่องทาง</option>
              <option value="LINE">LINE</option>
              <option value="SMS">SMS</option>
              <option value="IN_APP">ในระบบ</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            >
              <option value="">ทุกสถานะ</option>
              <option value="SENT">ส่งแล้ว</option>
              <option value="FAILED">ล้มเหลว</option>
              <option value="PENDING">รอส่ง</option>
            </select>
          </div>
          <DataTable columns={logColumns} data={logs} isLoading={logsLoading} emptyMessage="ยังไม่มีประวัติ" />
        </>
      )}

      {activeTab === 'templates' && (
        <>
          <div className="mb-4">
            <button
              onClick={openCreateTemplate}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
            >
              + สร้าง Template
            </button>
          </div>
          <DataTable columns={templateColumns} data={templates} isLoading={templatesLoading} emptyMessage="ยังไม่มี template" />
        </>
      )}

      {/* Template Modal */}
      <Modal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        title={editingTemplate ? 'แก้ไข Template' : 'สร้าง Template ใหม่'}
        size="lg"
      >
        <form onSubmit={handleTemplateSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ Template *</label>
            <input
              type="text"
              value={templateForm.name}
              onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทเหตุการณ์ *</label>
              <select
                value={templateForm.eventType}
                onChange={(e) => setTemplateForm({ ...templateForm, eventType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              >
                <option value="PAYMENT_REMINDER">เตือนชำระ</option>
                <option value="OVERDUE_NOTICE">ทวงหนี้</option>
                <option value="PAYMENT_SUCCESS">ชำระสำเร็จ</option>
                <option value="CONTRACT_DEFAULT">ผิดนัด</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ช่องทาง *</label>
              <select
                value={templateForm.channel}
                onChange={(e) => setTemplateForm({ ...templateForm, channel: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              >
                <option value="LINE">LINE</option>
                <option value="SMS">SMS</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ข้อความ *</label>
            <textarea
              value={templateForm.messageTemplate}
              onChange={(e) => setTemplateForm({ ...templateForm, messageTemplate: e.target.value })}
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none font-mono"
              placeholder="สวัสดีค่ะ คุณ{customer_name}&#10;แจ้งเตือนค่างวดที่ {installment_no}..."
              required
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {placeholdersList.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() =>
                    setTemplateForm({
                      ...templateForm,
                      messageTemplate: templateForm.messageTemplate + p,
                    })
                  }
                  className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600 hover:bg-gray-200"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">คำอธิบาย</label>
            <input
              type="text"
              value={templateForm.description}
              onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsTemplateModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saveTemplateMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {saveTemplateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

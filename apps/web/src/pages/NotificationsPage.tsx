import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
  format?: string;
  subject: string | null;
  messageTemplate: string;
  flexTemplate?: string;
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

// Default Flex JSON templates for each event type
const defaultFlexTemplates: Record<string, object> = {
  PAYMENT_REMINDER: {
    type: 'flex',
    altText: 'แจ้งเตือน: ค่างวดที่ {installment_no} จำนวน {amount} บาท ครบกำหนด {due_date}',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'BEST CHOICE', size: 'xs', color: '#FFFFFF', weight: 'bold' },
          { type: 'text', text: 'แจ้งเตือนค่างวด', size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' },
          { type: 'text', text: 'สัญญา {contract_number}', size: 'xs', color: '#FFFFFFBB', margin: 'sm' },
        ],
        backgroundColor: '#1DB446',
        paddingAll: '20px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'สวัสดีค่ะ คุณ{customer_name}', size: 'md', color: '#333333', weight: 'bold' },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center', margin: 'lg',
            contents: [
              { type: 'text', text: 'ยอดชำระ', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{amount} บาท', size: 'xl', color: '#1DB446', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          { type: 'separator', margin: 'lg', color: '#EEEEEE' },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md',
            contents: [
              { type: 'text', text: 'งวดที่', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{installment_no}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md',
            contents: [
              { type: 'text', text: 'ครบกำหนด', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{due_date}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          { type: 'text', text: 'กรุณาชำระเงินก่อนครบกำหนด เพื่อหลีกเลี่ยงค่าปรับ', size: 'xs', color: '#888888', wrap: true, margin: 'xl' },
        ],
        paddingAll: '20px',
        spacing: 'sm',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', action: { type: 'postback', label: 'ชำระเงิน', data: 'action=pay&contract={contract_number}' }, style: 'primary', color: '#1DB446', height: 'sm' },
          { type: 'button', action: { type: 'postback', label: 'ดูรายละเอียด', data: 'action=check_installments&contract={contract_number}' }, style: 'primary', color: '#AAAAAA', height: 'sm' },
        ],
        paddingAll: '15px',
        spacing: 'sm',
      },
    },
  },
  OVERDUE_NOTICE: {
    type: 'flex',
    altText: 'แจ้งเตือน: ค่างวดที่ {installment_no} ค้างชำระ {amount} บาท เลยกำหนด {overdue_days} วัน',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'BEST CHOICE', size: 'xs', color: '#FFFFFF', weight: 'bold' },
          { type: 'text', text: 'แจ้งเตือนค้างชำระ', size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' },
          { type: 'text', text: 'สัญญา {contract_number}', size: 'xs', color: '#FFFFFFBB', margin: 'sm' },
        ],
        backgroundColor: '#DD2C00',
        paddingAll: '20px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'คุณ{customer_name}', size: 'md', color: '#333333', weight: 'bold' },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center', margin: 'lg',
            contents: [
              { type: 'text', text: 'ยอดค้างชำระ', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{amount} บาท', size: 'xl', color: '#DD2C00', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          { type: 'separator', margin: 'lg', color: '#EEEEEE' },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md',
            contents: [
              { type: 'text', text: 'งวดที่', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{installment_no}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md',
            contents: [
              { type: 'text', text: 'ค่าปรับ', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{late_fee} บาท', size: 'sm', color: '#DD2C00', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md',
            contents: [
              { type: 'text', text: 'เลยกำหนด', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{overdue_days} วัน', size: 'sm', color: '#DD2C00', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          { type: 'text', text: 'กรุณาชำระโดยเร็วเพื่อหลีกเลี่ยงค่าปรับเพิ่มเติม', size: 'xs', color: '#888888', wrap: true, margin: 'xl' },
        ],
        paddingAll: '20px',
        spacing: 'sm',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', action: { type: 'postback', label: 'ชำระเงินทันที', data: 'action=pay&contract={contract_number}' }, style: 'primary', color: '#DD2C00', height: 'sm' },
        ],
        paddingAll: '15px',
        spacing: 'sm',
      },
    },
  },
  PAYMENT_SUCCESS: {
    type: 'flex',
    altText: 'ชำระเงินสำเร็จ: สัญญา {contract_number} งวดที่ {installment_no} จำนวน {amount} บาท',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'BEST CHOICE', size: 'xs', color: '#FFFFFF', weight: 'bold' },
          { type: 'text', text: 'ชำระเงินสำเร็จ', size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' },
          { type: 'text', text: 'สัญญา {contract_number}', size: 'xs', color: '#FFFFFFBB', margin: 'sm' },
        ],
        backgroundColor: '#1DB446',
        paddingAll: '20px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'คุณ{customer_name}', size: 'md', color: '#333333', weight: 'bold' },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center', margin: 'lg',
            contents: [
              { type: 'text', text: 'จำนวนเงิน', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{amount} บาท', size: 'xl', color: '#1DB446', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          { type: 'separator', margin: 'lg', color: '#EEEEEE' },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md',
            contents: [
              { type: 'text', text: 'งวดที่', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{installment_no}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md',
            contents: [
              { type: 'text', text: 'วันที่ชำระ', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{due_date}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
          { type: 'text', text: 'ขอบคุณที่ชำระตรงเวลาค่ะ', size: 'xs', color: '#1DB446', wrap: true, margin: 'xl', weight: 'bold' },
        ],
        paddingAll: '20px',
        spacing: 'sm',
      },
    },
  },
  CONTRACT_DEFAULT: {
    type: 'flex',
    altText: 'แจ้งเตือน: สัญญา {contract_number} มีสถานะผิดนัดชำระ',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'BEST CHOICE', size: 'xs', color: '#FFFFFF', weight: 'bold' },
          { type: 'text', text: 'แจ้งเตือนผิดนัดชำระ', size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' },
          { type: 'text', text: 'สัญญา {contract_number}', size: 'xs', color: '#FFFFFFBB', margin: 'sm' },
        ],
        backgroundColor: '#DD2C00',
        paddingAll: '20px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'คุณ{customer_name}', size: 'md', color: '#333333', weight: 'bold' },
          { type: 'text', text: 'สัญญาของท่านอยู่ในสถานะผิดนัดชำระ กรุณาติดต่อเจ้าหน้าที่โดยเร็ว', size: 'sm', color: '#DD2C00', wrap: true, margin: 'lg' },
          {
            type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'lg',
            contents: [
              { type: 'text', text: 'ยอดค้างทั้งหมด', size: 'sm', color: '#888888', flex: 0 },
              { type: 'text', text: '{amount} บาท', size: 'xl', color: '#DD2C00', weight: 'bold', align: 'end', flex: 0 },
            ],
          },
        ],
        paddingAll: '20px',
        spacing: 'sm',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', action: { type: 'postback', label: 'ติดต่อเจ้าหน้าที่', data: 'action=contact' }, style: 'primary', color: '#DD2C00', height: 'sm' },
        ],
        paddingAll: '15px',
        spacing: 'sm',
      },
    },
  },
};

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
    format: 'text' as 'text' | 'flex',
    subject: '',
    messageTemplate: '',
    flexTemplate: '',
    description: '',
  });
  const [jsonError, setJsonError] = useState<string | null>(null);

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
      format: 'text',
      subject: '',
      messageTemplate: '',
      flexTemplate: '',
      description: '',
    });
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

  const validateJson = useCallback((json: string): boolean => {
    if (!json.trim()) {
      setJsonError(null);
      return true;
    }
    try {
      const parsed = JSON.parse(json);
      if (parsed.type !== 'flex') {
        setJsonError('JSON ต้องมี "type": "flex" เป็น root');
        return false;
      }
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError(`JSON ไม่ถูกต้อง: ${e instanceof Error ? e.message : 'parse error'}`);
      return false;
    }
  }, []);

  const handleFlexTemplateChange = (value: string) => {
    setTemplateForm({ ...templateForm, flexTemplate: value });
    validateJson(value);
  };

  const loadDefaultFlexTemplate = () => {
    const defaultTemplate = defaultFlexTemplates[templateForm.eventType];
    if (defaultTemplate) {
      const json = JSON.stringify(defaultTemplate, null, 2);
      setTemplateForm({ ...templateForm, flexTemplate: json });
      setJsonError(null);
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(templateForm.flexTemplate);
      setTemplateForm({ ...templateForm, flexTemplate: JSON.stringify(parsed, null, 2) });
      setJsonError(null);
    } catch {
      // Already has error from validateJson
    }
  };

  const handleTemplateSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (templateForm.format === 'flex' && templateForm.flexTemplate) {
      if (!validateJson(templateForm.flexTemplate)) return;
    }
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
        <div className="max-w-xs truncate text-sm text-muted-foreground">{l.message}</div>
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
        <span className="text-xs text-muted-foreground">
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
      key: 'format',
      label: 'รูปแบบ',
      render: (t: NotificationTemplate) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          t.format === 'flex' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
        }`}>
          {t.format === 'flex' ? 'Flex JSON' : 'Text'}
        </span>
      ),
    },
    {
      key: 'messageTemplate',
      label: 'ข้อความ',
      render: (t: NotificationTemplate) => (
        <div className="max-w-xs truncate text-sm text-muted-foreground">{t.messageTemplate}</div>
      ),
    },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (t: NotificationTemplate) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
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
          className="text-primary hover:text-primary/80 text-sm font-medium"
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
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-sm text-muted-foreground">ทั้งหมด</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-sm text-muted-foreground">ส่งสำเร็จ</div>
            <div className="text-2xl font-bold text-green-600">{stats.sent}</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-sm text-muted-foreground">ล้มเหลว</div>
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-sm text-muted-foreground">รอส่ง</div>
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          </div>
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
      </div>

      {activeTab === 'logs' && (
        <>
          <div className="flex gap-3 mb-4">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
            >
              <option value="">ทุกช่องทาง</option>
              <option value="LINE">LINE</option>
              <option value="SMS">SMS</option>
              <option value="IN_APP">ในระบบ</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
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
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
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
        <form onSubmit={handleTemplateSave} className="flex flex-col gap-5 lg:gap-7.5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ชื่อ Template *</label>
            <input
              type="text"
              value={templateForm.name}
              onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ประเภทเหตุการณ์ *</label>
              <select
                value={templateForm.eventType}
                onChange={(e) => setTemplateForm({ ...templateForm, eventType: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              >
                <option value="PAYMENT_REMINDER">เตือนชำระ</option>
                <option value="OVERDUE_NOTICE">ทวงหนี้</option>
                <option value="PAYMENT_SUCCESS">ชำระสำเร็จ</option>
                <option value="CONTRACT_DEFAULT">ผิดนัด</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ช่องทาง *</label>
              <select
                value={templateForm.channel}
                onChange={(e) => setTemplateForm({ ...templateForm, channel: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              >
                <option value="LINE">LINE</option>
                <option value="SMS">SMS</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">รูปแบบ *</label>
              <select
                value={templateForm.format}
                onChange={(e) => setTemplateForm({ ...templateForm, format: e.target.value as 'text' | 'flex' })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                disabled={templateForm.channel !== 'LINE'}
              >
                <option value="text">ข้อความ (Text)</option>
                <option value="flex">Flex Message (JSON)</option>
              </select>
            </div>
          </div>

          {/* Text Message Template */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {templateForm.format === 'flex' ? 'ข้อความสำรอง (altText / SMS fallback) *' : 'ข้อความ *'}
            </label>
            <textarea
              value={templateForm.messageTemplate}
              onChange={(e) => setTemplateForm({ ...templateForm, messageTemplate: e.target.value })}
              rows={templateForm.format === 'flex' ? 3 : 5}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none font-mono"
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
                  className="px-2 py-0.5 bg-muted rounded text-xs text-muted-foreground hover:bg-muted"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Flex JSON Editor (LINE + flex only) */}
          {templateForm.channel === 'LINE' && templateForm.format === 'flex' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-foreground">
                  Flex Message JSON *
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={loadDefaultFlexTemplate}
                    className="px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 font-medium"
                  >
                    โหลด Template เริ่มต้น
                  </button>
                  <button
                    type="button"
                    onClick={formatJson}
                    className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 font-medium"
                  >
                    จัด Format JSON
                  </button>
                  <a
                    href="https://developers.line.biz/flex-simulator/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-md hover:bg-green-200 font-medium"
                  >
                    LINE Flex Simulator
                  </a>
                </div>
              </div>
              <textarea
                value={templateForm.flexTemplate}
                onChange={(e) => handleFlexTemplateChange(e.target.value)}
                rows={16}
                className={`w-full px-3 py-2 border rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none font-mono leading-relaxed ${
                  jsonError ? 'border-red-400 bg-red-50/50' : 'border-input'
                }`}
                placeholder='{"type":"flex","altText":"...","contents":{...}}'
                spellCheck={false}
              />
              {jsonError && (
                <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-600">{jsonError}</p>
                </div>
              )}
              <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <p className="text-xs text-purple-700 font-medium mb-1">ใช้ Placeholder ใน JSON ได้:</p>
                <div className="flex flex-wrap gap-1">
                  {placeholdersList.map((p) => (
                    <button
                      key={`flex-${p}`}
                      type="button"
                      onClick={() => {
                        const el = document.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]');
                        if (el) {
                          const start = el.selectionStart;
                          const end = el.selectionEnd;
                          const before = templateForm.flexTemplate.slice(0, start);
                          const after = templateForm.flexTemplate.slice(end);
                          const newVal = before + p + after;
                          setTemplateForm({ ...templateForm, flexTemplate: newVal });
                          validateJson(newVal);
                          setTimeout(() => {
                            el.focus();
                            el.setSelectionRange(start + p.length, start + p.length);
                          }, 0);
                        }
                      }}
                      className="px-2 py-0.5 bg-purple-100 rounded text-xs text-purple-700 hover:bg-purple-200"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-purple-500 mt-2">
                  ระบบจะแทนที่ placeholder ด้วยข้อมูลจริงก่อนส่ง เช่น {'{customer_name}'} → ชื่อลูกค้า
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">คำอธิบาย</label>
            <input
              type="text"
              value={templateForm.description}
              onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsTemplateModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saveTemplateMutation.isPending || (templateForm.format === 'flex' && !!jsonError)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {saveTemplateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

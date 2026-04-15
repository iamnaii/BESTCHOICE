import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import DataTable from '@/components/ui/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, notificationChannelMap, activeStatusMap } from '@/lib/status-badges';

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

const eventTypeLabels: Record<string, string> = {
  PAYMENT_REMINDER: 'เตือนชำระ',
  OVERDUE_NOTICE: 'ทวงหนี้',
  PAYMENT_SUCCESS: 'ชำระสำเร็จ',
  CONTRACT_DEFAULT: 'ผิดนัด',
};

interface TemplateManagerProps {
  activeTab: string;
  onCreateTemplate: () => void;
  onEditTemplate: (t: NotificationTemplate) => void;
  onConfirmDelete: (message: string, action: () => void) => void;
}

export default function TemplateManager({
  activeTab,
  onCreateTemplate,
  onEditTemplate,
  onConfirmDelete,
}: TemplateManagerProps) {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading: templatesLoading } = useQuery<NotificationTemplate[]>({
    queryKey: ['notification-templates'],
    queryFn: async () => (await api.get('/notifications/templates')).data,
    enabled: activeTab === 'templates',
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/notifications/templates/${id}`),
    onSuccess: () => {
      toast.success('ลบเทมเพลตสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

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
      render: (t: NotificationTemplate) => {
        const cfg = getStatusBadgeProps(t.channel, notificationChannelMap);
        return (
          <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      key: 'format',
      label: 'รูปแบบ',
      render: (t: NotificationTemplate) => (
        <Badge variant={t.format === 'flex' ? 'info' : 'primary'} appearance="light">
          {t.format === 'flex' ? 'Flex JSON' : 'Text'}
        </Badge>
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
      render: (t: NotificationTemplate) => {
        const cfg = getStatusBadgeProps(t.isActive ? 'active' : 'inactive', activeStatusMap);
        return (
          <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
            {t.isActive ? 'เปิดใช้งาน' : 'ปิด'}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (t: NotificationTemplate) => (
        <div className="flex gap-2">
          <button
            onClick={() => onEditTemplate(t)}
            className="text-primary hover:text-primary/80 text-sm font-medium"
          >
            แก้ไข
          </button>
          <button
            onClick={() =>
              onConfirmDelete('ต้องการลบ template นี้?', () =>
                deleteTemplateMutation.mutate(t.id),
              )
            }
            disabled={deleteTemplateMutation.isPending}
            className="text-red-600 hover:text-red-500 text-sm font-medium"
          >
            ลบ
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4">
        <button
          onClick={onCreateTemplate}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          + สร้าง Template
        </button>
      </div>
      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={templateColumns}
            data={templates}
            isLoading={templatesLoading}
            emptyMessage="ยังไม่มี template"
          />
        </CardContent>
      </Card>
    </>
  );
}

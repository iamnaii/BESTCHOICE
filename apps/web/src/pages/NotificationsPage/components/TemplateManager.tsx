import { useState } from 'react';
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
  category?: string;
  channelKey?: string | null;
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
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const { data: templates = [], isLoading: templatesLoading } = useQuery<NotificationTemplate[]>({
    queryKey: ['notification-templates', categoryFilter],
    queryFn: async () => {
      const url = categoryFilter
        ? `/notifications/templates?category=${categoryFilter}`
        : '/notifications/templates';
      return (await api.get(url)).data;
    },
    enabled: activeTab === 'templates',
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (eventType: string) =>
      api.delete(`/notifications/templates/${eventType}`),
    onSuccess: () => {
      toast.success('ลบเทมเพลตสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const templateColumns = [
    {
      key: 'name',
      label: 'ชื่อ Template',
      render: (t: NotificationTemplate) => (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t.name}</span>
          {!t.isActive && (
            <span className="px-2 py-0.5 bg-warning/15 text-warning text-xs rounded">
              ปิดใช้งาน
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'eventType',
      label: 'Event Type',
      render: (t: NotificationTemplate) => (
        <span className="text-sm font-mono">
          {eventTypeLabels[t.eventType] || t.eventType}
        </span>
      ),
    },
    {
      key: 'category',
      label: 'หมวดหมู่',
      render: (t: NotificationTemplate) => (
        <span className="text-xs text-muted-foreground">{t.category || '-'}</span>
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
                deleteTemplateMutation.mutate(t.eventType),
              )
            }
            disabled={deleteTemplateMutation.isPending}
            className="text-destructive hover:text-destructive/80 text-sm font-medium"
          >
            ลบ
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={onCreateTemplate}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          + สร้าง Template
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-sm text-muted-foreground">หมวดหมู่:</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
          >
            <option value="">ทั้งหมด</option>
            <option value="DUNNING">DUNNING (ทวงหนี้)</option>
            <option value="REMINDER">REMINDER (เตือนก่อนงวด)</option>
            <option value="TRANSACTIONAL">TRANSACTIONAL (ใบเสร็จ)</option>
            <option value="STAFF">STAFF (ทีม)</option>
            <option value="MARKETING">MARKETING (โปรโมชั่น)</option>
          </select>
        </div>
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

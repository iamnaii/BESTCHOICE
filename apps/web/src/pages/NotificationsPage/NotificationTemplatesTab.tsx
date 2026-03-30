import DataTable from '@/components/ui/DataTable';
import { NotificationTemplate, channelLabels, eventTypeLabels } from './types';

interface Props {
  templates: NotificationTemplate[];
  isLoading: boolean;
  onCreateTemplate: () => void;
  onEditTemplate: (t: NotificationTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  isDeletingTemplate: boolean;
}

export default function NotificationTemplatesTab({
  templates, isLoading, onCreateTemplate, onEditTemplate, onDeleteTemplate, isDeletingTemplate,
}: Props) {
  const columns = [
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
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          t.isActive ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
        }`}>
          {t.isActive ? 'เปิดใช้งาน' : 'ปิด'}
        </span>
      ),
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
            onClick={() => { if (confirm('ต้องการลบ template นี้?')) onDeleteTemplate(t.id); }}
            disabled={isDeletingTemplate}
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
      <DataTable columns={columns} data={templates} isLoading={isLoading} emptyMessage="ยังไม่มี template" />
    </>
  );
}

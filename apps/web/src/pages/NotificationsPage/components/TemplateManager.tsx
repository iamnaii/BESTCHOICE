import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Pencil, Trash2 } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';

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

interface TemplateManagerProps {
  activeTab: string;
  onCreateTemplate: () => void;
  onEditTemplate: (t: NotificationTemplate) => void;
  onConfirmDelete: (message: string, action: () => void) => void;
}

function categoryStyles(cat: string | undefined): string {
  switch (cat) {
    case 'DUNNING':
      return 'bg-destructive/10 text-destructive';
    case 'REMINDER':
      return 'bg-primary/10 text-primary';
    case 'TRANSACTIONAL':
      return 'bg-accent text-accent-foreground';
    case 'STAFF':
      return 'bg-muted text-muted-foreground';
    case 'MARKETING':
      return 'bg-secondary text-secondary-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
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
    mutationFn: async (eventType: string) => api.delete(`/notifications/templates/${eventType}`),
    onSuccess: () => {
      toast.success('ลบเทมเพลตสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleDelete = (eventType: string) => {
    onConfirmDelete('ต้องการลบ template นี้?', () => deleteTemplateMutation.mutate(eventType));
  };

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

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  ชื่อ Template
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Event Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  หมวดหมู่
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  ช่องทาง
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  รูปแบบ
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  ข้อความ
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  สถานะ
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody>
              {templatesLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    กำลังโหลด...
                  </td>
                </tr>
              ) : templates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    ยังไม่มี template
                  </td>
                </tr>
              ) : (
                templates.map((template) => (
                  <tr
                    key={template.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground leading-snug">
                        {template.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                        {template.eventType}
                      </code>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${categoryStyles(template.category)}`}
                      >
                        {template.category || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground">
                        {template.channel}
                        {template.channelKey && ` · ${template.channelKey.replace('line-', '')}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs text-muted-foreground">
                        {template.format === 'flex' ? 'Flex' : 'Text'}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <div className="truncate text-sm text-muted-foreground">
                        {template.messageTemplate}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {template.isActive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary font-medium">
                          <CheckCircle2 className="size-3" />
                          เปิดใช้งาน
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground font-medium">
                          <XCircle className="size-3" />
                          ปิด
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => onEditTemplate(template)}
                          className="p-2 rounded-lg hover:bg-accent text-foreground"
                          title="แก้ไข"
                          aria-label="แก้ไข"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(template.eventType)}
                          disabled={deleteTemplateMutation.isPending}
                          className="p-2 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-50"
                          title="ลบ"
                          aria-label="ลบ"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

import { Eye } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SmsTemplate } from '../hooks/useSmsTemplates';
import { usePreviewTemplate } from '../hooks/useSmsTemplates';

const LOCAL_DEFAULT_SAMPLE: Record<string, string> = {
  customerName: 'สมชาย ใจดี',
  contractNumber: 'CT-2026-000123',
  amount: '5,400',
  amountDue: '5,400',
  dueDate: '25 เม.ย. 2569',
  daysOverdue: '7',
  installmentNo: '4',
  paymentLink: 'https://pay.bestchoice.com/abc123',
};

interface Props {
  template: SmsTemplate | null;
  /**
   * Live body from the form (un-saved changes). When provided we render
   * client-side using the same {{var}} pattern so the operator sees changes
   * before clicking save. Once they save, the server-rendered preview takes
   * over (single source of truth).
   */
  liveBody?: string;
}

/**
 * Rendering strategy:
 * - When the user types in the form, we render client-side from `liveBody` so
 *   the preview tracks every keystroke without server round-trips.
 * - When the user clicks "Refresh from server" (or selects an existing template
 *   without unsaved edits), we hit `POST /sms-templates/:id/preview` so the
 *   exact same renderer that ships real messages produces the preview —
 *   eliminating drift between editor and production.
 */
export function SmsTemplatePreview({ template, liveBody }: Props) {
  const [serverRendered, setServerRendered] = useState<string | null>(null);
  const previewMutation = usePreviewTemplate();

  // Reset server preview when switching templates
  useEffect(() => {
    setServerRendered(null);
  }, [template?.id]);

  const clientRendered = useMemo(() => {
    const source = liveBody ?? template?.body ?? '';
    return source.replace(/\{\{(\w+)\}\}/g, (m, key) => LOCAL_DEFAULT_SAMPLE[key] ?? m);
  }, [liveBody, template?.body]);

  // Prefer server output when available AND the body hasn't changed since.
  const display =
    serverRendered && (liveBody === undefined || liveBody === template?.body)
      ? serverRendered
      : clientRendered;

  const handleServerRender = async () => {
    if (!template) return;
    const result = await previewMutation.mutateAsync({ id: template.id });
    setServerRendered(result.rendered);
  };

  if (!template) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <Eye className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">เลือก template เพื่อดูตัวอย่าง</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">ตัวอย่างข้อความ</h3>
        </div>
        <button
          type="button"
          onClick={handleServerRender}
          disabled={previewMutation.isPending}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-50"
        >
          {previewMutation.isPending ? 'กำลังโหลด...' : 'Render จาก server'}
        </button>
      </div>

      <div className="p-4 space-y-3">
        {template.subject && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">หัวข้อ</div>
            <div className="text-sm font-medium leading-snug">{template.subject}</div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted-foreground mb-1">เนื้อหา</div>
          <div className="text-sm leading-snug whitespace-pre-wrap rounded-md bg-muted/40 p-3">
            {display || (
              <span className="text-muted-foreground italic">(ว่าง)</span>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground leading-snug">
          ค่าตัวอย่าง: {Object.entries(LOCAL_DEFAULT_SAMPLE).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ')}…
        </div>
      </div>
    </div>
  );
}

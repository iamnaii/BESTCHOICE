import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';

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
  sampleData?: Record<string, unknown> | null;
  updatedAt: string;
}

export interface TemplateFormState {
  eventType: string;
  name: string;
  category: string;
  channelKey: string | null;
  channel: string;
  format: 'text' | 'flex';
  subject: string;
  messageTemplate: string;
  flexTemplate: string;
  description: string;
  isActive: boolean;
  sampleData: string;
}

function extractVariables(template: string): string[] {
  const regex = /\$\{([^}]+)\}/g;
  const seen = new Set<string>();
  const order: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const varName = match[1].trim();
    if (!seen.has(varName)) {
      seen.add(varName);
      order.push(varName);
    }
  }
  return order;
}

function tryParseJson(s: string): unknown {
  try {
    return s.trim() ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

interface TemplateFormProps {
  isOpen: boolean;
  onClose: () => void;
  editingTemplate: NotificationTemplate | null;
  templateForm: TemplateFormState;
  setTemplateForm: React.Dispatch<React.SetStateAction<TemplateFormState>>;
  jsonError: string | null;
  setJsonError: (err: string | null) => void;
}

// Variable hints — names match seeded templates (camelCase) and use ${var} syntax to match
// the backend P3 substitution regex: /\$\{([^}]+)\}/g
const VARIABLE_HINTS = [
  'name',
  'amount',
  'contractNumber',
  'daysOverdue',
  'installmentNo',
  'dueDate',
  'paymentUrl',
  'totalOverdue',
  'date',
  'count',
  'totalAmount',
];

// Legacy {var} placeholders kept ONLY for the flex JSON editor — the seeded flex
// templates above still use {var} style inside the JSON. The P3 backend handles
// flex via the same regex, but we leave the legacy chips here untouched until
// flex defaults are migrated.
const flexPlaceholdersList = [
  '{customer_name}',
  '{contract_number}',
  '{amount}',
  '{due_date}',
  '{installment_no}',
  '{late_fee}',
  '{branch_name}',
  '{overdue_days}',
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

export default function TemplateForm({
  isOpen,
  onClose,
  editingTemplate,
  templateForm,
  setTemplateForm,
  jsonError,
  setJsonError,
}: TemplateFormProps) {
  const queryClient = useQueryClient();
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    rendered: string;
    flexJson?: unknown;
  } | null>(null);

  const saveTemplateMutation = useMutation({
    mutationFn: async (data: TemplateFormState) => {
      const payload: Record<string, unknown> = {
        ...data,
        sampleData: data.sampleData ? tryParseJson(data.sampleData) : null,
      };
      if (editingTemplate) {
        delete payload.eventType; // immutable on update
        return api.patch(`/notifications/templates/${editingTemplate.eventType}`, payload);
      }
      return api.post('/notifications/templates', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      toast.success(editingTemplate ? 'อัพเดท template สำเร็จ' : 'สร้าง template สำเร็จ');
      onClose();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const data = tryParseJson(templateForm.sampleData) ?? undefined;
      const res = await api.post(
        `/notifications/templates/${templateForm.eventType}/preview`,
        { data },
      );
      return res.data as { rendered: string; flexJson?: unknown };
    },
    onSuccess: (data) => {
      setPreviewResult(data);
      setPreviewModalOpen(true);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const testSendMutation = useMutation({
    mutationFn: async () => {
      const data = tryParseJson(templateForm.sampleData) ?? undefined;
      const res = await api.post(
        `/notifications/templates/${templateForm.eventType}/test-send`,
        { data },
      );
      return res.data;
    },
    onSuccess: () => toast.success('ส่งทดสอบเรียบร้อย — เช็ค LINE/SMS ของคุณ'),
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const variables = extractVariables(templateForm.messageTemplate);

  // Live preview — client-side substitution so it updates on every keystroke
  // without a server round-trip. Renders ${var} → value from sampleData JSON.
  // Unmatched ${var} stays as ${var} so authors can spot missing data.
  const livePreview = useMemo(() => {
    let data: Record<string, string> = {};
    try {
      const parsed = JSON.parse(templateForm.sampleData);
      if (parsed && typeof parsed === 'object') {
        data = parsed as Record<string, string>;
      }
    } catch {
      // sampleData not valid JSON yet — render with empty data
    }
    return templateForm.messageTemplate.replace(
      /\$\{([^}]+)\}/g,
      (_, varName: string) => {
        const trimmed = varName.trim();
        const val = data[trimmed];
        return val !== undefined && val !== null ? String(val) : `\${${trimmed}}`;
      },
    );
  }, [templateForm.messageTemplate, templateForm.sampleData]);

  const insertVariable = (varName: string) => {
    setTemplateForm((prev) => ({
      ...prev,
      messageTemplate: `${prev.messageTemplate}\${${varName}}`,
    }));
  };

  const validateJson = useCallback(
    (json: string): boolean => {
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
    },
    [setJsonError],
  );

  const handleFlexTemplateChange = (value: string) => {
    setTemplateForm((prev) => ({ ...prev, flexTemplate: value }));
    validateJson(value);
  };

  const loadDefaultFlexTemplate = () => {
    const defaultTemplate = defaultFlexTemplates[templateForm.eventType];
    if (defaultTemplate) {
      const json = JSON.stringify(defaultTemplate, null, 2);
      setTemplateForm((prev) => ({ ...prev, flexTemplate: json }));
      setJsonError(null);
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(templateForm.flexTemplate);
      setTemplateForm((prev) => ({ ...prev, flexTemplate: JSON.stringify(parsed, null, 2) }));
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingTemplate ? 'แก้ไข Template' : 'สร้าง Template ใหม่'}
      size="lg"
    >
      <form onSubmit={handleTemplateSave} className="flex flex-col gap-5 lg:gap-7.5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Event Type *</label>
            <input
              type="text"
              value={templateForm.eventType}
              onChange={(e) =>
                setTemplateForm((prev) => ({ ...prev, eventType: e.target.value }))
              }
              disabled={!!editingTemplate}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden disabled:opacity-60"
              placeholder="dunning.reminder"
              required
            />
            <div className="text-xs text-muted-foreground mt-1">
              ใช้สำหรับ scheduler หา template เช่น dunning.reminder, payment.due_in_3_days
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ชื่อ Template *</label>
            <input
              type="text"
              value={templateForm.name}
              onChange={(e) => setTemplateForm((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">หมวดหมู่ *</label>
            <select
              value={templateForm.category}
              onChange={(e) =>
                setTemplateForm((prev) => ({ ...prev, category: e.target.value }))
              }
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
            >
              <option value="DUNNING">DUNNING (ทวงหนี้)</option>
              <option value="REMINDER">REMINDER (เตือนก่อนงวด)</option>
              <option value="TRANSACTIONAL">TRANSACTIONAL (ใบเสร็จ)</option>
              <option value="STAFF">STAFF (ทีม)</option>
              <option value="MARKETING">MARKETING (โปรโมชั่น)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ช่องทาง *</label>
            <select
              value={templateForm.channel}
              onChange={(e) => setTemplateForm((prev) => ({ ...prev, channel: e.target.value }))}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
            >
              <option value="LINE">LINE</option>
              <option value="SMS">SMS</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">รูปแบบ *</label>
            <select
              value={templateForm.format}
              onChange={(e) =>
                setTemplateForm((prev) => ({
                  ...prev,
                  format: e.target.value as 'text' | 'flex',
                }))
              }
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
              disabled={templateForm.channel !== 'LINE'}
            >
              <option value="text">ข้อความ (Text)</option>
              <option value="flex">Flex Message (JSON)</option>
            </select>
          </div>
        </div>

        {/* Text Message Template + Live Preview (split on desktop) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {templateForm.format === 'flex' ? 'ข้อความสำรอง (altText / SMS fallback) *' : 'ข้อความ *'}
            </label>
            <textarea
              value={templateForm.messageTemplate}
              onChange={(e) =>
                setTemplateForm((prev) => ({ ...prev, messageTemplate: e.target.value }))
              }
              rows={templateForm.format === 'flex' ? 4 : 6}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden font-mono"
              placeholder="สวัสดีค่ะ คุณ${name}&#10;แจ้งเตือนค่างวดที่ ${installmentNo}..."
              required
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {VARIABLE_HINTS.map((varName) => (
                <button
                  key={varName}
                  type="button"
                  onClick={() => insertVariable(varName)}
                  className="px-2 py-0.5 bg-muted rounded text-xs text-muted-foreground hover:bg-accent font-mono"
                >
                  {`\${${varName}}`}
                </button>
              ))}
            </div>
            {variables.length > 0 && (
              <div className="text-xs text-muted-foreground mt-2">
                Variables ที่ตรวจพบ:
                {variables.map((v) => (
                  <code
                    key={v}
                    className="mx-1 px-1 bg-muted rounded text-xs"
                  >{`\${${v}}`}</code>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              ตัวอย่างที่จะส่ง (live)
            </label>
            <div className="border border-border rounded-lg p-4 bg-muted/30 min-h-[160px]">
              <div className="bg-card rounded-2xl px-4 py-3 max-w-md shadow-sm whitespace-pre-wrap text-sm text-foreground">
                {livePreview ? (
                  livePreview
                ) : (
                  <span className="text-muted-foreground italic">ยังไม่มีข้อความ</span>
                )}
              </div>
              <div className="mt-2 text-xs text-muted-foreground leading-snug">
                แทนค่าจาก JSON ด้านล่าง (sampleData) — {`\${var}`} ที่ไม่มีค่าจะแสดงเป็น{' '}
                {`\${var}`} ตามเดิม
              </div>
            </div>
          </div>
        </div>

        {/* Sample data editor */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            ข้อมูลตัวอย่าง (JSON สำหรับ preview)
          </label>
          <textarea
            value={templateForm.sampleData}
            onChange={(e) =>
              setTemplateForm((prev) => ({ ...prev, sampleData: e.target.value }))
            }
            className="w-full px-3 py-2 border border-input rounded-lg font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
            rows={4}
            placeholder='{"name":"สมหมาย","amount":"1500"}'
          />
        </div>

        {/* Preview + Test send buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending || !templateForm.eventType || !editingTemplate}
            className="px-4 py-2 border border-input rounded-lg text-sm hover:bg-accent disabled:opacity-50"
            title={!editingTemplate ? 'บันทึก template ก่อนเพื่อใช้ Preview' : ''}
          >
            {previewMutation.isPending ? 'กำลัง...' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={() => testSendMutation.mutate()}
            disabled={testSendMutation.isPending || !templateForm.eventType || !editingTemplate}
            className="px-4 py-2 border border-input rounded-lg text-sm hover:bg-accent disabled:opacity-50"
            title={!editingTemplate ? 'บันทึก template ก่อนเพื่อใช้ Test send' : ''}
          >
            {testSendMutation.isPending ? 'กำลังส่ง...' : 'ส่งทดสอบให้ตัวเอง'}
          </button>
        </div>

        {/* Flex JSON Editor (LINE + flex only) */}
        {templateForm.channel === 'LINE' && templateForm.format === 'flex' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-foreground">Flex Message JSON *</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={loadDefaultFlexTemplate}
                  className="px-3 py-1 text-xs bg-info/10 text-info dark:bg-info/15 rounded-md hover:bg-info/20 font-medium"
                >
                  โหลด Template เริ่มต้น
                </button>
                <button
                  type="button"
                  onClick={formatJson}
                  className="px-3 py-1 text-xs bg-primary/10 text-primary rounded-md hover:bg-primary/20 font-medium"
                >
                  จัด Format JSON
                </button>
                <a
                  href="https://developers.line.biz/flex-simulator/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 text-xs bg-success/10 text-success dark:bg-success/15 rounded-md hover:bg-success/20 font-medium"
                >
                  LINE Flex Simulator
                </a>
              </div>
            </div>
            <textarea
              value={templateForm.flexTemplate}
              onChange={(e) => handleFlexTemplateChange(e.target.value)}
              rows={16}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden font-mono leading-relaxed ${
                jsonError ? 'border-destructive bg-destructive/5' : 'border-input'
              }`}
              placeholder='{"type":"flex","altText":"...","contents":{...}}'
              spellCheck={false}
            />
            {jsonError && (
              <div className="mt-1 p-2 bg-destructive/5 dark:bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-xs text-destructive">{jsonError}</p>
              </div>
            )}
            <div className="mt-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <p className="text-xs text-primary font-medium mb-1">ใช้ Placeholder ใน JSON ได้:</p>
              <div className="flex flex-wrap gap-1">
                {flexPlaceholdersList.map((p) => (
                  <button
                    key={`flex-${p}`}
                    type="button"
                    onClick={() => {
                      const el =
                        document.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]');
                      if (el) {
                        const start = el.selectionStart;
                        const end = el.selectionEnd;
                        const before = templateForm.flexTemplate.slice(0, start);
                        const after = templateForm.flexTemplate.slice(end);
                        const newVal = before + p + after;
                        setTemplateForm((prev) => ({ ...prev, flexTemplate: newVal }));
                        validateJson(newVal);
                        setTimeout(() => {
                          el.focus();
                          el.setSelectionRange(start + p.length, start + p.length);
                        }, 0);
                      }
                    }}
                    className="px-2 py-0.5 bg-primary/10 rounded text-xs text-primary hover:bg-primary/20"
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p className="text-xs text-primary/70 mt-2">
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
            onChange={(e) =>
              setTemplateForm((prev) => ({ ...prev, description: e.target.value }))
            }
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={
              saveTemplateMutation.isPending ||
              (templateForm.format === 'flex' && !!jsonError)
            }
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saveTemplateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>

      {previewModalOpen && previewResult && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setPreviewModalOpen(false)}
        >
          <div
            className="bg-card rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold mb-2">Preview</h3>
            <pre className="bg-muted p-3 rounded text-sm whitespace-pre-wrap mb-2">
              {previewResult.rendered}
            </pre>
            {previewResult.flexJson != null && (
              <pre className="mt-2 bg-muted p-3 rounded text-xs overflow-auto max-h-64">
                {JSON.stringify(previewResult.flexJson, null, 2)}
              </pre>
            )}
            <button
              type="button"
              onClick={() => setPreviewModalOpen(false)}
              className="mt-4 px-4 py-2 border border-input rounded-lg text-sm hover:bg-accent"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import type { CreateBody, SmsChannel, SmsTemplate, TemplateVariable } from '../hooks/useSmsTemplates';

const DEFAULT_VARIABLES: TemplateVariable[] = [
  { name: 'customerName', label: 'ชื่อลูกค้า' },
  { name: 'contractNumber', label: 'เลขที่สัญญา' },
  { name: 'amount', label: 'ยอดที่ค้างชำระ' },
  { name: 'dueDate', label: 'วันครบกำหนด' },
  { name: 'daysOverdue', label: 'จำนวนวันที่ค้าง' },
  { name: 'installmentNo', label: 'งวดที่' },
  { name: 'paymentLink', label: 'ลิงก์ชำระเงิน' },
];

const CHANNEL_OPTIONS: { value: SmsChannel; label: string }[] = [
  { value: 'LINE', label: 'LINE' },
  { value: 'SMS', label: 'SMS' },
];

interface Props {
  initial?: SmsTemplate | null;
  onSubmit: (body: CreateBody) => Promise<void> | void;
  onBodyChange?: (body: string) => void;
  submitting?: boolean;
  submitLabel?: string;
}

export function SmsTemplateForm({
  initial,
  onSubmit,
  onBodyChange,
  submitting,
  submitLabel = 'บันทึก',
}: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [channel, setChannel] = useState<SmsChannel>(initial?.channel ?? 'LINE');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [variables, setVariables] = useState<TemplateVariable[]>(
    initial?.variables ?? DEFAULT_VARIABLES,
  );

  // Notify parent (preview pane) of body changes for live render
  useEffect(() => {
    onBodyChange?.(body);
  }, [body, onBodyChange]);

  // Re-seed when switching to a different template
  useEffect(() => {
    setName(initial?.name ?? '');
    setChannel(initial?.channel ?? 'LINE');
    setSubject(initial?.subject ?? '');
    setBody(initial?.body ?? '');
    setActive(initial?.active ?? true);
    setVariables(initial?.variables ?? DEFAULT_VARIABLES);
  }, [initial?.id]);

  const insertVar = (varName: string) => {
    setBody((prev) => `${prev}{{${varName}}}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name: name.trim(),
      channel,
      subject: subject.trim() || null,
      body,
      variables,
      active,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">ชื่อ template</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          placeholder="เช่น เตือนค่างวด D-3"
          className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as SmsChannel)}
            className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary"
            />
            <span className="text-sm text-foreground">เปิดใช้งาน (active)</span>
          </label>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          หัวข้อ (subject){' '}
          <span className="text-muted-foreground text-xs">(ไม่บังคับ)</span>
        </label>
        <input
          type="text"
          value={subject ?? ''}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="หัวข้อ (ใช้กับ SMS / preheader LINE)"
          className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">เนื้อหา</label>
        <div className="flex flex-wrap gap-1 mb-2">
          {variables.map((v) => (
            <button
              key={v.name}
              type="button"
              onClick={() => insertVar(v.name)}
              title={v.label}
              className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors"
            >
              {`{{${v.name}}}`}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={6}
          maxLength={2000}
          placeholder="สวัสดีคุณ {{customerName}} ค่างวด {{installmentNo}} ยอด {{amount}} บาท..."
          className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          {body.length} / 2000 ตัวอักษร · ใช้ {`{{ชื่อตัวแปร}}`} เพื่อแทนค่าจริงตอนส่ง
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {submitting ? 'กำลังบันทึก...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

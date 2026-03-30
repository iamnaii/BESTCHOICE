import { useState, useCallback, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { NotificationTemplate, placeholdersList, defaultFlexTemplates } from './types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  editingTemplate: NotificationTemplate | null;
  onSave: (data: Record<string, unknown>) => void;
  isSaving: boolean;
}

const INPUT_CLS =
  'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

const DEFAULT_FORM = {
  name: '',
  eventType: 'PAYMENT_REMINDER',
  channel: 'LINE',
  format: 'text' as 'text' | 'flex',
  subject: '',
  messageTemplate: '',
  flexTemplate: '',
  description: '',
};

export default function TemplateModal({ isOpen, onClose, editingTemplate, onSave, isSaving }: Props) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Reset form whenever the modal opens or editing target changes
  useEffect(() => {
    if (!isOpen) return;
    if (editingTemplate) {
      setForm({
        name: editingTemplate.name,
        eventType: editingTemplate.eventType,
        channel: editingTemplate.channel,
        format: (editingTemplate.format as 'text' | 'flex') || 'text',
        subject: editingTemplate.subject || '',
        messageTemplate: editingTemplate.messageTemplate,
        flexTemplate: editingTemplate.flexTemplate || '',
        description: editingTemplate.description || '',
      });
    } else {
      setForm(DEFAULT_FORM);
    }
    setJsonError(null);
  }, [isOpen, editingTemplate]);

  const validateJson = useCallback((json: string): boolean => {
    if (!json.trim()) { setJsonError(null); return true; }
    try {
      const parsed = JSON.parse(json);
      if (parsed.type !== 'flex') { setJsonError('JSON ต้องมี "type": "flex" เป็น root'); return false; }
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError(`JSON ไม่ถูกต้อง: ${e instanceof Error ? e.message : 'parse error'}`);
      return false;
    }
  }, []);

  const handleFlexChange = (value: string) => {
    setForm((f) => ({ ...f, flexTemplate: value }));
    validateJson(value);
  };

  const loadDefaultFlex = () => {
    const tpl = defaultFlexTemplates[form.eventType];
    if (tpl) { setForm((f) => ({ ...f, flexTemplate: JSON.stringify(tpl, null, 2) })); setJsonError(null); }
  };

  const formatJson = () => {
    try {
      setForm((f) => ({ ...f, flexTemplate: JSON.stringify(JSON.parse(f.flexTemplate), null, 2) }));
      setJsonError(null);
    } catch { /* already flagged */ }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.format === 'flex' && form.flexTemplate && !validateJson(form.flexTemplate)) return;
    onSave(form);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editingTemplate ? 'แก้ไข Template' : 'สร้าง Template ใหม่'} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 lg:gap-7.5">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">ชื่อ Template *</label>
          <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={INPUT_CLS} required />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ประเภทเหตุการณ์ *</label>
            <select value={form.eventType} onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))} className={INPUT_CLS}>
              <option value="PAYMENT_REMINDER">เตือนชำระ</option>
              <option value="OVERDUE_NOTICE">ทวงหนี้</option>
              <option value="PAYMENT_SUCCESS">ชำระสำเร็จ</option>
              <option value="CONTRACT_DEFAULT">ผิดนัด</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ช่องทาง *</label>
            <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} className={INPUT_CLS}>
              <option value="LINE">LINE</option>
              <option value="SMS">SMS</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">รูปแบบ *</label>
            <select
              value={form.format}
              onChange={(e) => setForm((f) => ({ ...f, format: e.target.value as 'text' | 'flex' }))}
              className={INPUT_CLS}
              disabled={form.channel !== 'LINE'}
            >
              <option value="text">ข้อความ (Text)</option>
              <option value="flex">Flex Message (JSON)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            {form.format === 'flex' ? 'ข้อความสำรอง (altText / SMS fallback) *' : 'ข้อความ *'}
          </label>
          <textarea
            value={form.messageTemplate}
            onChange={(e) => setForm((f) => ({ ...f, messageTemplate: e.target.value }))}
            rows={form.format === 'flex' ? 3 : 5}
            className={`${INPUT_CLS} font-mono`}
            placeholder="สวัสดีค่ะ คุณ{customer_name}&#10;แจ้งเตือนค่างวดที่ {installment_no}..."
            required
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {placeholdersList.map((p) => (
              <button key={p} type="button" onClick={() => setForm((f) => ({ ...f, messageTemplate: f.messageTemplate + p }))} className="px-2 py-0.5 bg-muted rounded text-xs text-muted-foreground hover:bg-muted">
                {p}
              </button>
            ))}
          </div>
        </div>

        {form.channel === 'LINE' && form.format === 'flex' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-foreground">Flex Message JSON *</label>
              <div className="flex gap-2">
                <button type="button" onClick={loadDefaultFlex} className="px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 font-medium">โหลด Template เริ่มต้น</button>
                <button type="button" onClick={formatJson} className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 font-medium">จัด Format JSON</button>
                <a href="https://developers.line.biz/flex-simulator/" target="_blank" rel="noopener noreferrer" className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-md hover:bg-green-200 font-medium">LINE Flex Simulator</a>
              </div>
            </div>
            <textarea
              value={form.flexTemplate}
              onChange={(e) => handleFlexChange(e.target.value)}
              rows={16}
              className={`${INPUT_CLS} font-mono leading-relaxed ${jsonError ? 'border-red-400 bg-red-50/50' : ''}`}
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
                        const newVal = form.flexTemplate.slice(0, start) + p + form.flexTemplate.slice(end);
                        setForm((f) => ({ ...f, flexTemplate: newVal }));
                        validateJson(newVal);
                        setTimeout(() => { el.focus(); el.setSelectionRange(start + p.length, start + p.length); }, 0);
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
          <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={INPUT_CLS} />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">ยกเลิก</button>
          <button
            type="submit"
            disabled={isSaving || (form.format === 'flex' && !!jsonError)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

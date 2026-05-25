import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import BubbleList from './BubbleList';
import QuickReplyEditor from './QuickReplyEditor';
import type { CannedResponse } from './types';

interface Props {
  template: CannedResponse | null;
  existingCategories: string[];
  onSave: (patch: Partial<CannedResponse>) => Promise<void>;
}

export default function TemplateEditorPane({ template, existingCategories, onSave }: Props) {
  const [form, setForm] = useState({
    title: '',
    shortcut: '',
    category: '',
    isActive: true,
    hideFromChat: false,
    verifiedOnly: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setForm({
        title: template.title,
        shortcut: template.shortcut,
        category: template.category ?? '',
        isActive: template.isActive,
        hideFromChat: template.hideFromChat ?? false,
        verifiedOnly: template.verifiedOnly ?? false,
      });
    }
  }, [template]);

  if (!template) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground leading-snug bg-muted/10">
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
          เลือก template เพื่อแก้ไข
        </div>
      </div>
    );
  }

  const isDirty =
    form.title !== template.title ||
    form.shortcut !== template.shortcut ||
    (form.category || null) !== template.category ||
    form.isActive !== template.isActive ||
    form.hideFromChat !== (template.hideFromChat ?? false) ||
    form.verifiedOnly !== (template.verifiedOnly ?? false);

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error('กรุณากรอกชื่อ template');
      return;
    }
    if (!form.shortcut.trim()) {
      toast.error('กรุณากรอก shortcut');
      return;
    }
    const normalizedShortcut = form.shortcut.startsWith('/') ? form.shortcut : `/${form.shortcut}`;
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        shortcut: normalizedShortcut,
        category: form.category.trim() || null,
        isActive: form.isActive,
        hideFromChat: form.hideFromChat,
        verifiedOnly: form.verifiedOnly,
      });
      toast.success('บันทึกแล้ว');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground leading-snug">แก้ไข Template</div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => template && setForm({
              title: template.title,
              shortcut: template.shortcut,
              category: template.category ?? '',
              isActive: template.isActive,
              hideFromChat: template.hideFromChat ?? false,
              verifiedOnly: template.verifiedOnly ?? false,
            })}
            disabled={!isDirty || saving}
          >
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || saving} size="sm">
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="title" className="text-xs">ชื่อ Template</Label>
            <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="shortcut" className="text-xs">Shortcut</Label>
            <Input id="shortcut" value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} placeholder="/example" />
          </div>
        </div>
        <div>
          <Label htmlFor="category" className="text-xs">หมวด</Label>
          <Input
            id="category"
            list="existing-categories"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="เลือกหมวดเดิมหรือพิมพ์ใหม่"
          />
          <datalist id="existing-categories">
            {existingCategories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <BubbleList cannedResponseId={template.id} />
        <div className="border-t border-border pt-4">
          <QuickReplyEditor cannedResponseId={template.id} />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isActive"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="rounded"
          />
          <Label htmlFor="isActive" className="text-sm leading-snug">เปิดใช้งาน (ปิด = ซ่อนจาก picker)</Label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="hideFromChat"
            checked={form.hideFromChat}
            onChange={(e) => setForm({ ...form, hideFromChat: e.target.checked })}
            className="rounded"
          />
          <Label htmlFor="hideFromChat" className="text-sm leading-snug">ซ่อนจากหน้าแชท (เก็บไว้ในระบบแต่ไม่โชว์ใน picker)</Label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="verifiedOnly"
            checked={form.verifiedOnly}
            onChange={(e) => setForm({ ...form, verifiedOnly: e.target.checked })}
            className="rounded"
          />
          <Label htmlFor="verifiedOnly" className="text-sm leading-snug">สำหรับลูกค้าที่ยืนยันตัวตนแล้วเท่านั้น</Label>
        </div>
      </div>
    </div>
  );
}

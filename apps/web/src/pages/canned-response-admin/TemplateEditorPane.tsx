import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import type { CannedResponse } from './types';

interface Props {
  template: CannedResponse | null;
  existingCategories: string[];
  onSave: (patch: Partial<CannedResponse>) => Promise<void>;
}

const VARIABLES = [
  '{customerName}',
  '{customerPhone}',
  '{contractNumber}',
  '{amountDue}',
  '{dueDate}',
  '{installmentNo}',
  '{branchName}',
];

export default function TemplateEditorPane({ template, existingCategories, onSave }: Props) {
  const [form, setForm] = useState({
    title: '',
    shortcut: '',
    content: '',
    category: '',
    isActive: true,
  });
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (template) {
      setForm({
        title: template.title,
        shortcut: template.shortcut,
        content: template.content,
        category: template.category ?? '',
        isActive: template.isActive,
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
    form.content !== template.content ||
    (form.category || null) !== template.category ||
    form.isActive !== template.isActive;

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
        content: form.content,
        category: form.category.trim() || null,
        isActive: form.isActive,
      });
      toast.success('บันทึกแล้ว');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const insertVariable = (v: string) => {
    const ta = contentRef.current;
    if (!ta) {
      setForm({ ...form, content: form.content + v });
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = form.content.slice(0, start) + v + form.content.slice(end);
    setForm({ ...form, content: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + v.length;
    });
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
              content: template.content,
              category: template.category ?? '',
              isActive: template.isActive,
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
        <div>
          <Label htmlFor="content" className="text-xs">เนื้อหา</Label>
          <Textarea
            id="content"
            ref={contentRef}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="min-h-[200px] font-mono text-sm leading-relaxed"
          />
        </div>
        <div>
          <Label className="text-xs">ตัวแปร (คลิกเพื่อใส่ที่ตำแหน่ง cursor)</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {VARIABLES.map((v) => (
              <button
                key={v}
                onClick={() => insertVariable(v)}
                className="px-2 py-1 text-[11px] font-mono bg-muted hover:bg-emerald-50 hover:text-emerald-700 rounded border border-border"
              >
                {v}
              </button>
            ))}
          </div>
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
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  defaultName: string;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

export function SaveAsTemplateModal({ defaultName, isLoading, onCancel, onConfirm }: Props) {
  const [name, setName] = useState(defaultName);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) onConfirm(name.trim());
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-card rounded-xl border p-5 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">บันทึกเป็น Template</h3>
          <button onClick={onCancel} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="text-xs text-muted-foreground font-medium">ชื่อ Template</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2 text-sm bg-background"
            placeholder="เช่น ดอกเบี้ย KBank รายเดือน"
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-md border text-sm"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isLoading}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {isLoading ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

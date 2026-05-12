import { useState } from 'react';
import { XCircle } from 'lucide-react';

interface Props {
  docNumber: string;
  onCancel: () => void;
  onConfirm: (note: string) => void;
  isLoading?: boolean;
}

export function RejectModal({ docNumber, onCancel, onConfirm, isLoading }: Props) {
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-background rounded-2xl border-2 border-destructive max-w-2xl w-full p-6">
        <h3 className="text-lg font-bold flex items-center gap-2 text-destructive mb-3">
          <XCircle size={20} /> ปฏิเสธคำขออนุมัติ
        </h3>
        <p className="text-sm mb-4">
          ปฏิเสธเอกสาร <span className="font-mono font-bold">{docNumber}</span> —
          ระบบจะส่งเอกสารกลับเป็นสถานะ DRAFT พร้อมเหตุผลของผู้ปฏิเสธ
        </p>
        <label className="text-xs font-semibold uppercase">เหตุผลการปฏิเสธ</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          placeholder="เหตุผลการปฏิเสธ"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            type="button"
            className="px-4 py-2 text-sm font-semibold rounded-md border"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => onConfirm(note.trim())}
            disabled={note.trim().length === 0 || isLoading}
            className="px-5 py-2 text-sm font-bold rounded-md bg-destructive text-destructive-foreground disabled:opacity-50"
          >
            {isLoading ? 'กำลังปฏิเสธ...' : 'ปฏิเสธ'}
          </button>
        </div>
      </div>
    </div>
  );
}

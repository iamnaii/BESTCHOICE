import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import type { LetterRow } from '../hooks/useLetterQueue';

interface Props {
  open: boolean;
  letters: LetterRow[];
  onClose: () => void;
}

export default function BulkSlipUploadDialog({ open, letters, onClose }: Props) {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  function handleClose() {
    if (busy) return;
    setFiles({});
    onClose();
  }

  const handleSubmit = async () => {
    const pairs = letters
      .map((l) => ({ letter: l, file: files[l.id] }))
      .filter((p): p is { letter: LetterRow; file: File } => !!p.file);

    if (pairs.length === 0) {
      toast.error('กรุณาเลือกไฟล์อย่างน้อย 1 รายการ');
      return;
    }

    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const { letter, file } of pairs) {
      try {
        const { data: presigned } = await api.post('/shop/upload/signed-url', {
          kind: 'LETTER_EVIDENCE',
          contentType: file.type,
        });
        const up = await fetch(presigned.uploadUrl, {
          method: presigned.method ?? 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });
        if (!up.ok) throw new Error('Upload failed');

        await api.patch(`/overdue/letters/${letter.id}/evidence`, {
          evidencePhotoUrl: presigned.publicUrl,
        });
        ok++;
      } catch (err) {
        fail++;
        console.error(`Letter ${letter.letterNumber}:`, err);
      }
    }

    qc.invalidateQueries({ queryKey: ['letter-queue'] });
    toast.success(
      `อัปโหลดสำเร็จ ${ok}/${pairs.length}${fail ? ` (ล้มเหลว ${fail})` : ''}`,
    );
    setBusy(false);
    setFiles({});
    onClose();
  };

  const selectedCount = Object.values(files).filter(Boolean).length;

  return (
    <Modal isOpen={open} onClose={handleClose} title="อัปโหลดสลิปชุด">
      <div className="space-y-3 p-1">
        <div className="text-xs text-muted-foreground leading-snug">
          เลือกรูปสลิปไปรษณีย์สำหรับแต่ละหนังสือ — สามารถข้ามได้ถ้ายังไม่มี
        </div>

        <div className="max-h-96 overflow-y-auto space-y-px border border-border/50 rounded-lg divide-y divide-border/30">
          {letters.map((l) => {
            const f = files[l.id];
            return (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2.5 bg-background">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-snug truncate">
                    {l.contract.customer.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-snug tabular-nums">
                    {l.letterNumber}
                    {l.trackingNumber && (
                      <>
                        {' · EMS: '}
                        <span className="font-mono">{l.trackingNumber}</span>
                      </>
                    )}
                  </div>
                  {f && (
                    <div className="text-[10px] text-success leading-snug mt-0.5 truncate">
                      {f.name} ({(f.size / 1024).toFixed(0)} KB)
                    </div>
                  )}
                </div>
                <label className="shrink-0 cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      const picked = e.target.files?.[0] ?? null;
                      setFiles((prev) => ({ ...prev, [l.id]: picked }));
                    }}
                  />
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-lg border transition-colors ${
                      f
                        ? 'border-success/40 bg-success/5 text-success'
                        : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Upload className="size-3" />
                    {f ? 'เปลี่ยน' : 'เลือก'}
                  </span>
                </label>
              </div>
            );
          })}
        </div>

        {selectedCount > 0 && (
          <div className="text-xs text-muted-foreground leading-snug tabular-nums">
            เลือกแล้ว {selectedCount} / {letters.length} รายการ
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={handleClose}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || selectedCount === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังอัปโหลด...
              </>
            ) : (
              <>
                <Upload className="size-4" />
                อัปโหลดทั้งหมด{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

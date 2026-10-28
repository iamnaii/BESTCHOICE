import { useEffect, useState } from 'react';
import { Camera, ImageOff } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchPunchPhotoUrl } from '@/hooks/useAttendance';

interface Props {
  punchId: string | null;
  label: string;
}

/** รูปหลักฐานตอนตอก — โหลดเมื่อกด (stream ผ่าน JWT) · ไม่มีรูป = ไอคอนกล้องขีด */
export default function PhotoThumb({ punchId, label }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !punchId || url) return;
    let revoked: string | null = null;
    fetchPunchPhotoUrl(punchId)
      .then((u) => { revoked = u; setUrl(u); })
      .catch(() => setError('โหลดรูปไม่ได้ (อาจถูกลบตามอายุเก็บ)'));
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [open, punchId, url]);

  if (!punchId) {
    return <span role="img" className="inline-flex size-9 items-center justify-center rounded-lg border border-dashed border-input text-muted-foreground" aria-label="ไม่มีรูป"><ImageOff className="size-4" aria-hidden="true" /></span>;
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`ดูรูป ${label}`} className="inline-flex size-11 lg:size-9 items-center justify-center rounded-lg bg-foreground text-background">
        <Camera className="size-4" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>รูปตอนตอกบัตร — {label}</DialogTitle>
            <DialogDescription>รูปจากเครื่องตอกบัตรประจำสาขา (ถ่ายอัตโนมัติตอนกดยืนยัน)</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : url ? <img src={url} alt={`รูปตอนตอกบัตรของ ${label}`} className="w-full rounded-lg" /> : <p className="text-sm text-muted-foreground">กำลังโหลดรูป…</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

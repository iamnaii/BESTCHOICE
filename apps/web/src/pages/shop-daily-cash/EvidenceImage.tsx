import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EVIDENCE_IMAGE_ACCEPT, EVIDENCE_IMAGE_MAX_BYTES } from './cash-close';

/** ลิงก์ "ดูสลิป" — รูปอยู่หลังสิทธิ์ของ API จึงดึงเป็น blob แล้วแสดงในกล่อง ไม่ใช่ลิงก์ตรง */
export function EvidenceImageLink({ path, label = 'ดูสลิป', title }: { path: string; label?: string; title: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['shop-tenders', 'evidence', path],
    queryFn: async () => (await api.get(path, { responseType: 'blob' })).data as Blob,
    enabled: open, staleTime: 5 * 60 * 1000,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!query.data) return undefined;
    const objectUrl = URL.createObjectURL(query.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [query.data]);

  return (
    <>
      <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>{label}</button>
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>รูปหลักฐานที่แนบไว้ตอนบันทึก</DialogDescription>
            </DialogHeader>
            {query.isLoading && <div className="h-64 animate-pulse rounded-lg bg-muted" />}
            {query.isError && <p className="text-sm text-destructive leading-snug">เปิดรูปไม่สำเร็จ: {getErrorMessage(query.error)}</p>}
            {url && <img src={url} alt={title} className="w-full rounded-lg border border-border" />}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** ช่องแนบรูปหลักฐาน (ถ่ายจากมือถือได้) — ตรวจชนิด/ขนาดก่อนส่ง · ด่านจริงอยู่ที่ API */
export function EvidenceImageInput({ label, file, onChange }: { label: string; file: File | null; onChange: (file: File | null) => void }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const pick = (next: File | undefined) => {
    if (!next) return;
    if (!EVIDENCE_IMAGE_ACCEPT.split(',').includes(next.type)) { setError('รองรับเฉพาะรูป JPEG, PNG หรือ WEBP'); onChange(null); return; }
    if (next.size > EVIDENCE_IMAGE_MAX_BYTES) { setError('รูปมีขนาดเกิน 5MB'); onChange(null); return; }
    setError(null); onChange(next);
  };

  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground leading-snug">{label} <span className="text-destructive">*</span></div>
      <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted text-center text-xs text-muted-foreground leading-snug">
          {preview ? <img src={preview} alt="ตัวอย่างรูปที่เลือก" className="h-full w-full object-cover" /> : 'ยังไม่ได้แนบรูป'}
        </div>
        <div className="space-y-1">
          {/* ซ่อนช่องไฟล์ของเบราว์เซอร์ (ข้อความ "ไม่ได้เลือกไฟล์" ของมันขัดกับรูปตัวอย่าง) — ปุ่มคือ label ของช่องนั้น */}
          <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-input bg-background px-3.5 text-sm text-foreground hover:bg-accent focus-within:outline focus-within:outline-2 focus-within:outline-ring">
            {file ? 'เปลี่ยนรูป' : 'ถ่ายรูป / เลือกรูป'}
            <input id={id} type="file" accept={EVIDENCE_IMAGE_ACCEPT} aria-label={label} className="sr-only"
              onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ''; }} />
          </label>
          <p className="break-all text-xs text-muted-foreground leading-snug">{file ? file.name : 'รูปสลิป JPEG / PNG / WEBP ไม่เกิน 5MB'}</p>
          {error && <p className="text-xs text-destructive leading-snug">{error}</p>}
        </div>
      </div>
    </div>
  );
}

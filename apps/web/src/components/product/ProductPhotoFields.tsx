import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, Lock, X } from '@/lib/icons';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { PHOTO_ANGLES, PHOTO_ANGLE_LABELS, type AnglePhotos } from '@/constants/photo-angles';

export const EVIDENCE_PHOTO_LABELS = {
  imeiScreen: 'หน้า IMEI',
  regulatory: 'ตราครุฑ',
  batteryScreen: 'หน้า % แบต',
  partsHistoryScreen: 'ประวัติการเปลี่ยนอะไหล่',
} as const;
export type EvidencePhotoKey = keyof typeof EVIDENCE_PHOTO_LABELS;
export type EvidencePhotos = Partial<Record<EvidencePhotoKey, string | null>>;
export type ProductPhotoKey = keyof AnglePhotos | EvidencePhotoKey;

/** Bound both dimensions; evidence screenshots stay legible without sending full camera originals. */
export function prepareProductPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    return Promise.reject(new Error('รองรับ JPG, PNG, WEBP และ GIF เท่านั้น'));
  }
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('ไฟล์รูปภาพต้องไม่เกิน 5MB'));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const release = () => URL.revokeObjectURL(url);
    image.onload = () => {
      try {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('ไม่สามารถประมวลผลรูปภาพได้');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (error) { reject(error); } finally { release(); }
    };
    image.onerror = () => { release(); reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้')); };
    image.src = url;
  });
}

/** Same named slots for creation and editing. Evidence never joins the six-angle collection. */
export default function ProductPhotoFields({
  photos = {}, evidencePhotos = {}, onChange, disabled = false, onBusyChange,
  evidenceOnly = false,
}: {
  photos?: Partial<AnglePhotos>;
  evidencePhotos?: EvidencePhotos;
  onChange?: (key: ProductPhotoKey, value: string | null) => void | Promise<void>;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  evidenceOnly?: boolean;
}) {
  const [busy, setBusy] = useState<ProductPhotoKey | null>(null);
  const processing = useRef(false);
  const [preview, setPreview] = useState<{ label: string; src: string } | null>(null);
  const changeFile = async (key: ProductPhotoKey, file?: File) => {
    if (!file || !onChange || disabled || processing.current) return;
    processing.current = true;
    setBusy(key);
    onBusyChange?.(true);
    try { await onChange(key, await prepareProductPhoto(file)); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'บันทึกรูปไม่สำเร็จ'); }
    finally { processing.current = false; setBusy(null); onBusyChange?.(false); }
  };
  const slot = (key: ProductPhotoKey, label: string, src?: string | null) => (
    <div key={key} className="min-w-0 space-y-1.5">
      <div className="relative aspect-square rounded-lg border border-dashed border-input bg-muted/30 overflow-hidden">
        {src ? <button type="button" className="size-full focus-visible:ring-2 focus-visible:ring-ring" aria-label={`ดูรูป${label}`} onClick={() => setPreview({ label, src })}>
          <img src={src} alt={`รูป${label}`} className="size-full object-contain" />
        </button> : <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <Camera className="size-6" aria-hidden="true" />
          <span className="text-xs leading-snug">{busy === key ? 'กำลังบันทึก…' : 'ยังไม่มีรูป'}</span>
        </div>}
        {onChange && src && <button type="button" aria-label={`ลบรูป${label}`} disabled={disabled || !!busy} onClick={() => { void onChange(key, null); }} className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-background/90 text-destructive disabled:opacity-50">
          <X className="size-4" aria-hidden="true" />
        </button>}
      </div>
      <p className="text-center text-xs font-medium leading-snug">{label}</p>
      {onChange && <label className={`relative flex min-h-9 items-center justify-center rounded-md border text-xs leading-snug ${disabled || busy ? 'opacity-50' : 'cursor-pointer hover:bg-accent'}`}>
        {busy === key ? 'กำลังบันทึก…' : src ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}
        <input aria-label={`อัปโหลดรูป${label}`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={disabled || !!busy} className="absolute inset-0 size-full cursor-pointer opacity-0" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; void changeFile(key, file);
        }} />
      </label>}
    </div>
  );
  return <div className="space-y-5">
    {!evidenceOnly && <section aria-label="รูปสินค้า 6 มุม" className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold leading-snug">รูปสินค้า 6 มุม</h3><span className="text-xs text-muted-foreground">{PHOTO_ANGLES.filter(key => photos[key]).length}/6</span></div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">{PHOTO_ANGLES.map(key => slot(key, PHOTO_ANGLE_LABELS[key], photos[key]))}</div>
    </section>}
    <section aria-label="หลักฐานประกอบสัญญา" className={evidenceOnly ? 'space-y-3' : 'space-y-3 border-t pt-5'}>
      <div className="flex items-center gap-2"><Lock className="size-4 text-muted-foreground" aria-hidden="true" /><h3 className="text-sm font-semibold leading-snug">หลักฐานประกอบสัญญา</h3></div>
      <p className="text-xs text-muted-foreground leading-snug">ใช้ภายในเท่านั้น · ไม่แสดงบนหน้าร้านหรือในรูปที่ส่งให้ลูกค้า · รูปประวัติการเปลี่ยนอะไหล่เพิ่มเมื่อมีการเปลี่ยน</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(Object.keys(EVIDENCE_PHOTO_LABELS) as EvidencePhotoKey[]).map(key => slot(key, EVIDENCE_PHOTO_LABELS[key], evidencePhotos[key]))}</div>
    </section>
    {onChange && <p className="text-xs text-muted-foreground leading-snug">รองรับ JPG, PNG, WEBP และ GIF ไม่เกิน 5MB/รูป</p>}
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }}>
      <DialogContent className="max-w-3xl"><DialogTitle>{preview?.label}</DialogTitle><DialogDescription className="sr-only">รูปถ่ายที่บันทึกไว้</DialogDescription>{preview && <img src={preview.src} alt={preview.label} className="max-h-[75vh] w-full object-contain" />}</DialogContent>
    </Dialog>
  </div>;
}

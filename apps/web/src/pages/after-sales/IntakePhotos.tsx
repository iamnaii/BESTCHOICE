import { useEffect, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { EVIDENCE_IMAGE_ACCEPT, EVIDENCE_IMAGE_MAX_BYTES } from '../shop-daily-cash/cash-close';

interface IntakePhotosProps {
  files: File[];
  onChange: (files: File[]) => void;
  max: number;
}

/** แถบรูปตอนรับฝากเครื่อง — กติกาไฟล์เดียวกับ `EvidenceImageInput` (ชนิด/ขนาด) แต่รับได้หลายรูป */
export default function IntakePhotos({ files, onChange, max }: IntakePhotosProps) {
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const handleFiles = (selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    const incoming = Array.from(selected);
    if (files.length + incoming.length > max) {
      toast.error(`เพิ่มรูปได้ไม่เกิน ${max} รูป`);
      return;
    }
    for (const file of incoming) {
      if (!EVIDENCE_IMAGE_ACCEPT.split(',').includes(file.type)) {
        toast.error('รองรับเฉพาะรูป JPEG, PNG หรือ WEBP');
        return;
      }
      if (file.size > EVIDENCE_IMAGE_MAX_BYTES) {
        toast.error('รูปมีขนาดเกิน 5MB');
        return;
      }
    }
    onChange([...files, ...incoming]);
  };

  return (
    <div className="flex flex-wrap gap-2.5">
      {files.map((file, index) => (
        <div key={`${file.name}-${index}`} className="relative">
          <img
            src={previews[index]}
            alt={`รูปที่แนบ ${index + 1}`}
            className="h-20 w-28 rounded-lg border border-border object-cover"
          />
          <button
            type="button"
            aria-label="ลบรูป"
            onClick={() => onChange(files.filter((_, i) => i !== index))}
            className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-accent"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {files.length < max && (
        <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted text-center text-xs leading-snug text-muted-foreground hover:bg-accent">
          <Camera aria-hidden className="h-5 w-5" />
          <span>ถ่ายเพิ่ม (สูงสุด {max})</span>
          <input
            type="file"
            accept={EVIDENCE_IMAGE_ACCEPT}
            capture="environment"
            multiple
            className="sr-only"
            onChange={(event) => {
              handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

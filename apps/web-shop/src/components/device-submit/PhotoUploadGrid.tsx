import { useRef } from 'react';
import { toast } from 'sonner';
import { X, Plus, Loader2 } from 'lucide-react';
import { useSignedUpload, type UploadKind } from '../../hooks/useSignedUpload';

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  kind: UploadKind;
}

export default function PhotoUploadGrid({ value, onChange, max = 8, kind }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useSignedUpload(kind);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = Math.max(0, max - value.length);
    if (remaining === 0) {
      toast.error(`อัปโหลดได้สูงสุด ${max} รูป`);
      return;
    }
    const selected = Array.from(files).slice(0, remaining);
    try {
      const uploaded: string[] = [];
      for (const f of selected) {
        const res = await upload.mutateAsync(f);
        uploaded.push(res.publicUrl);
      }
      onChange([...value, ...uploaded]);
    } catch (e) {
      toast.error('อัปโหลดรูปไม่สำเร็จ');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2 leading-snug">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {value.map((url, i) => (
          <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-muted">
            <img src={url} alt={`รูปที่ ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute top-1 right-1 rounded-full bg-background/90 p-1 hover:bg-background"
              aria-label="ลบรูป"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {value.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="aspect-square rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-accent"
          >
            {upload.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Plus className="h-5 w-5" />
                <span className="text-xs">เพิ่มรูป</span>
              </>
            )}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => onPick(e.target.files)}
        className="hidden"
      />
      <p className="text-xs text-muted-foreground">
        ถ่ายด้านหน้า ด้านหลัง ข้างตัวเครื่อง และจอแสดงผลตอนเปิดใช้งาน (สูงสุด {max} รูป)
      </p>
    </div>
  );
}

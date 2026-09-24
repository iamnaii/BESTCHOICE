import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EVIDENCE_IMAGE_ACCEPT, EVIDENCE_IMAGE_MAX_BYTES } from '../shop-daily-cash/cash-close';
import { afterSalesKeys } from './after-sales';

/**
 * ตารางเทียบรูปมุมต่อมุม (Step 3 ของ Task 11) — 6 คอลัมน์มุม × 2 แถว (ตอนซื้อ/ตอนรับฝาก)
 * grid คอลัมน์ [88px repeat(6,minmax(0,1fr))] ตามที่ brief กำหนด
 */
const ANGLES: { key: string; label: string }[] = [
  { key: 'front', label: 'หน้า' },
  { key: 'back', label: 'หลัง' },
  { key: 'left', label: 'ซ้าย' },
  { key: 'right', label: 'ขวา' },
  { key: 'top', label: 'บน' },
  { key: 'bottom', label: 'ล่าง' },
];

/** โหลดรูปเป็น blob แล้ว object URL (แบบ EvidenceImageLink) — แตะเปิด Dialog ขยาย */
function CaseImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['after-sales-image', src],
    queryFn: async () => (await api.get(src, { responseType: 'blob' })).data as Blob,
    staleTime: 5 * 60 * 1000,
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
      <button
        type="button"
        aria-label={alt}
        disabled={!url}
        onClick={() => url && setOpen(true)}
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted disabled:cursor-default"
      >
        {query.isLoading && <span className="h-full w-full animate-pulse bg-muted" />}
        {query.isError && (
          <span className="px-1 text-center text-xs leading-snug text-destructive">โหลดไม่ได้</span>
        )}
        {url && <img src={url} alt={alt} className="h-full w-full object-cover" />}
      </button>
      {open && url && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{alt}</DialogTitle>
              <DialogDescription>รูปหลักฐานของเคสนี้</DialogDescription>
            </DialogHeader>
            <img src={url} alt={alt} className="w-full rounded-lg border border-border" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function EmptySlot({ label }: { label: string }) {
  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-border text-center text-xs leading-snug text-muted-foreground">
      {label}
    </div>
  );
}

/** ช่องถัดไปที่ยังไม่ได้ถ่าย + staff role → มีปุ่ม "เพิ่มรูป" อัปโหลดทีละรูป (multipart file) */
function UploadSlot({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (
        await api.post(`/after-sales/${caseId}/photos`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      ).data;
    },
    onSuccess: () => {
      toast.success('เพิ่มรูปแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.case(caseId) });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!EVIDENCE_IMAGE_ACCEPT.split(',').includes(file.type)) {
      toast.error('รองรับเฉพาะรูป JPEG, PNG หรือ WEBP');
      return;
    }
    if (file.size > EVIDENCE_IMAGE_MAX_BYTES) {
      toast.error('รูปมีขนาดเกิน 5MB');
      return;
    }
    upload.mutate(file);
  };

  return (
    <label className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted text-center text-xs leading-snug text-muted-foreground hover:bg-accent">
      <span>ไม่ได้ถ่าย</span>
      <span className="inline-flex items-center gap-1 font-semibold text-primary">
        <Camera aria-hidden className="h-3.5 w-3.5" />
        {upload.isPending ? 'กำลังอัปโหลด…' : 'เพิ่มรูป'}
      </span>
      <input
        type="file"
        accept={EVIDENCE_IMAGE_ACCEPT}
        capture="environment"
        aria-label="เพิ่มรูปตอนรับฝาก"
        className="sr-only"
        disabled={upload.isPending}
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </label>
  );
}

interface PhotoCompareProps {
  caseId: string;
  photoCount: number;
  purchasePhotoAngles: string[];
  /** staff role (OWNER/BM/SALES) และเครื่องยังถ่ายไม่ครบ 6 มุม */
  canUpload: boolean;
}

export default function PhotoCompare({
  caseId,
  photoCount,
  purchasePhotoAngles,
  canUpload,
}: PhotoCompareProps) {
  const firstMissingIndex = photoCount < 6 ? photoCount : -1;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[88px_repeat(6,minmax(0,1fr))] gap-2">
        <div aria-hidden />
        {ANGLES.map((a) => (
          <div
            key={a.key}
            className="text-center text-xs font-semibold leading-snug text-muted-foreground"
          >
            {a.label}
          </div>
        ))}

        <div className="flex items-center text-xs font-semibold leading-snug text-muted-foreground">
          ตอนซื้อ
        </div>
        {ANGLES.map((a) =>
          purchasePhotoAngles.includes(a.key) ? (
            <CaseImage
              key={a.key}
              src={`/after-sales/${caseId}/purchase-photos/${a.key}`}
              alt={`รูปตอนซื้อมุม${a.label}`}
            />
          ) : (
            <EmptySlot key={a.key} label="ไม่มี" />
          ),
        )}

        <div className="flex items-center text-xs font-semibold leading-snug text-muted-foreground">
          ตอนรับฝาก
        </div>
        {ANGLES.map((a, index) =>
          index < photoCount ? (
            <CaseImage
              key={a.key}
              src={`/after-sales/${caseId}/photos/${index}`}
              alt={`รูปตอนรับฝากมุม${a.label}`}
            />
          ) : canUpload && index === firstMissingIndex ? (
            <UploadSlot key={a.key} caseId={caseId} />
          ) : (
            <EmptySlot key={a.key} label="ไม่ได้ถ่าย" />
          ),
        )}
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        รูปตอนซื้อบันทึกติดเคสตอนแจ้ง — ถ่ายรูปเครื่องใหม่ภายหลังไม่กระทบหลักฐาน
      </p>
    </div>
  );
}

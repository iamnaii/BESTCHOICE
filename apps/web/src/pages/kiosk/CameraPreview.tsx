import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';

export interface CameraHandle {
  /** ถ่าย 1 ภาพเป็น JPEG ย่อด้านยาว ≤ 640px · กล้องไม่พร้อม/ย่อไม่ได้ (เช่น ไม่มี canvas) → null */
  capture: () => Promise<Blob | null>;
}

export type CameraState = 'starting' | 'ready' | 'denied';

interface Props {
  onState?: (state: CameraState) => void;
}

const MAX_EDGE = 640;

/** กล้องหน้าของแท็บเล็ต — รูปเป็นหลักฐานย้อนหลัง (ไม่ใช่ด่านตอนกด): ไม่มีกล้อง/ไม่อนุญาต ยังตอกได้ */
const CameraPreview = forwardRef<CameraHandle, Props>(function CameraPreview({ onState }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('starting');

  useEffect(() => {
    let cancelled = false;
    const update = (s: CameraState) => {
      if (cancelled) return;
      setState(s);
      onState?.(s);
    };
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      update('denied');
      return () => { cancelled = true; };
    }
    media
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play?.().catch(() => undefined);
        }
        update('ready');
      })
      .catch(() => update('denied'));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // onState เป็น callback ที่เสถียรจากหน้าแม่ — ตั้งกล้องครั้งเดียวตอน mount
  }, []);

  useImperativeHandle(ref, () => ({
    capture: async () => {
      const video = videoRef.current;
      if (state !== 'ready' || !video || !video.videoWidth) return null;
      try {
        const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7));
      } catch {
        return null;
      }
    },
  }), [state]);

  return (
    <div className="relative flex min-h-[260px] flex-1 items-center justify-center overflow-hidden rounded-2xl bg-foreground">
      <video ref={videoRef} muted playsInline autoPlay className={`absolute inset-0 size-full object-cover ${state === 'ready' ? '' : 'hidden'}`} aria-label="ภาพจากกล้อง" />
      <div className="pointer-events-none absolute size-[55%] max-h-[280px] max-w-[220px] rounded-[50%] border-[3px] border-dashed border-background/60" aria-hidden="true" />
      <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-background/15 px-3 py-1.5 text-xs text-background">
        {state === 'denied' ? <CameraOff className="size-3.5" aria-hidden="true" /> : <Camera className="size-3.5" aria-hidden="true" />}
        {state === 'ready' ? 'กล้องพร้อม · ถ่ายอัตโนมัติตอนกดยืนยัน' : state === 'starting' ? 'กำลังเปิดกล้อง…' : 'กล้องใช้ไม่ได้ — จะบันทึกโดยไม่มีรูป'}
      </div>
      <div className="absolute inset-x-0 bottom-3 text-center text-sm text-background/80">ให้หน้าอยู่ในกรอบ</div>
    </div>
  );
});

export default CameraPreview;

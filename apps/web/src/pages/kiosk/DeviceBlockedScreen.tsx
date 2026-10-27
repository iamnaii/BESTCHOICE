import { Lock } from 'lucide-react';

interface Props {
  message: string;
  onRetry: () => void;
}

/** เครื่องถูกล็อก (token ชน) — เปิดหน้าตอกบัตรไม่ได้จนเจ้าของปลดล็อกแล้วลงทะเบียนใหม่ (mockup บอร์ด 2 ช่อง E) */
export default function DeviceBlockedScreen({ message, onRetry }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-2xl bg-foreground p-6 text-background" role="alert">
      <div className="flex items-center gap-3">
        <Lock className="size-9" aria-hidden="true" />
        <div className="text-2xl font-bold leading-snug">เครื่องนี้ถูกล็อก</div>
      </div>
      <p className="text-base leading-snug text-background/85">{message}</p>
      <p className="text-sm leading-snug text-background/85">เจ้าของได้รับงานแจ้งเตือนแล้ว · ปลดล็อกได้ที่ ตั้งค่า › สาขา › เครื่องตอกบัตร แล้วลงทะเบียนเครื่องใหม่ด้วยรหัสใหม่</p>
      <button type="button" onClick={onRetry} className="h-12 rounded-xl border border-background/30 text-base font-medium text-background">ตรวจสอบอีกครั้ง</button>
    </div>
  );
}

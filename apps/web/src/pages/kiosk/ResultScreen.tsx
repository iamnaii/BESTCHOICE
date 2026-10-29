import { Check, Clock, ImageOff, LogOut } from 'lucide-react';
import type { PunchResult } from '@/lib/kiosk-api';
import { formatHHmm } from './useServerClock';

interface Props {
  result: PunchResult;
  noPhoto: boolean;
  onDone: () => void;
}

const otText = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

/** ผลลัพธ์หลังตอก — แสดง 5 วินาทีแล้วกลับหน้าหลัก (mockup บอร์ด 2 ช่อง B/C) · ไม่แสดงเงิน */
export default function ResultScreen({ result, noPhoto, onDone }: Props) {
  const late = result.status === 'LATE';
  const tone = late ? 'border-warning/40 bg-warning/10' : 'border-primary/30 bg-primary/10';
  const statusLabel = result.status === 'ON_TIME' ? 'ตรงเวลา' : late ? `สาย ${result.lateMinutes} นาที` : result.status === 'OUT_OT' ? `OT ${otText(result.otHours)} ชั่วโมง` : 'ออกงานแล้ว';
  const Icon = result.status === 'ON_TIME' ? Check : late ? Clock : result.status === 'OUT_OT' ? Clock : LogOut;
  return (
    <div className={`mx-auto flex w-full max-w-xl flex-col gap-5 rounded-2xl border p-6 ${tone}`} role="status" aria-live="polite">
      <div className="flex items-start gap-4">
        <div className="flex size-24 flex-none items-center justify-center rounded-xl bg-foreground text-background">
          {noPhoto ? <ImageOff className="size-9" aria-hidden="true" /> : <Check className="size-9" aria-hidden="true" />}
        </div>
        <div className="min-w-0">
          <div className="text-3xl font-bold leading-snug">สวัสดี {result.nickname}</div>
          <div className="mt-1 text-lg leading-snug">{result.kind === 'IN' ? 'เข้างาน' : 'ออกงาน'} <b>{formatHHmm(result.at)}</b></div>
        </div>
      </div>
      <div className={`inline-flex w-fit items-center gap-2 rounded-full border bg-background px-4 py-2 text-base font-semibold ${late ? 'border-warning/40 text-warning-strong' : 'border-primary/30 text-primary'}`}>
        <Icon className="size-5" aria-hidden="true" />
        {statusLabel}
      </div>
      {noPhoto && <p className="text-sm text-muted-foreground leading-snug">ถ่ายรูปไม่ได้ — บันทึกโดยไม่มีรูป (รายการจะติดธงให้ผู้จัดการเห็น)</p>}
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>ถ้าไม่ใช่คุณ แจ้งผู้จัดการสาขาทันที — รูปและเวลาถูกเก็บไว้แล้ว</span>
        <button type="button" onClick={onDone} className="h-11 rounded-xl border border-input bg-background px-4 font-medium text-foreground">กลับหน้าหลัก</button>
      </div>
    </div>
  );
}

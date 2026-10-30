import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Lock, ShieldCheck } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { useClearConflict, useCorrectDay, type DayKind } from '@/hooks/useAttendance';
import { DAY_KIND_LABEL, attendancePaidMessage, hhmm, shiftDate, thaiShortDate } from '../../attendance.util';

export interface CorrectTarget {
  dayId: string;
  nickname: string;
  date: string; // YYYY-MM-DD
  clockIn: string | null;
  clockOut: string | null;
  dayKind: DayKind;
  flags: string[];
  /** เลขที่ใบเงินเดือนที่จ่ายเดือนนี้แล้ว — ไม่ null = บันทึกการแก้ไขไม่ได้ (ล้างธงยังได้) */
  paidDocumentNumber?: string | null;
}

interface Props {
  target: CorrectTarget | null;
  /** เจ้าของเท่านั้นที่ล้างธง DEVICE_CONFLICT ได้ (POST days/:id/clear-conflict) */
  isOwner: boolean;
  onClose: () => void;
}

const toIso = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString();
const MIN_REASON = 10;

/** แก้ไขเวลาเข้า-ออก/ประเภทวัน ย้อนหลัง — เหตุผลบังคับ ≥ 10 ตัวอักษร · ทุกการแก้มีประวัติ (สเปก §6) */
export default function CorrectDayDialog({ target, isOwner, onClose }: Props) {
  const correct = useCorrectDay();
  const clearConflict = useClearConflict();
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [dayKind, setDayKind] = useState<DayKind>('WORK');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!target) return;
    setClockIn(target.clockIn ? hhmm(target.clockIn) : '');
    setClockOut(target.clockOut ? hhmm(target.clockOut) : '');
    setDayKind(target.dayKind);
    setReason('');
  }, [target]);

  if (!target) return null;
  const originalIn = target.clockIn ? hhmm(target.clockIn) : '';
  const originalOut = target.clockOut ? hhmm(target.clockOut) : '';
  const changed = clockIn !== originalIn || clockOut !== originalOut || dayKind !== target.dayKind;
  const clearingIn = !clockIn && !!originalIn;
  const outWithoutIn = !clockIn && !!clockOut;
  // เวลาออกน้อยกว่าเวลาเข้า = ออกหลังเที่ยงคืน (วันถัดไป) — ตอกข้ามวันยังอยู่แถวของวันที่ IN
  const outNextDay = !!clockIn && !!clockOut && clockOut <= clockIn;
  const paid = target.paidDocumentNumber ?? null;
  const canSave = !paid && changed && !outWithoutIn && reason.trim().length >= MIN_REASON && !correct.isPending;
  const missingOut = target.flags.includes('MISSING_OUT');
  const conflict = target.flags.includes('DEVICE_CONFLICT');

  const markChecked = () =>
    clearConflict.mutate(target.dayId, {
      onSuccess: () => {
        toast.success(`ล้างธงเครื่องถูกใช้ซ้อนของ ${target.nickname} แล้ว`);
        onClose();
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });

  const save = () => {
    const payload: { dayId: string; clockIn?: string | null; clockOut?: string | null; dayKind?: DayKind; reason: string } = { dayId: target.dayId, reason: reason.trim() };
    if (clockIn !== originalIn) payload.clockIn = clockIn ? toIso(target.date, clockIn) : null;
    if (clockOut !== originalOut) payload.clockOut = clockOut ? toIso(outNextDay ? shiftDate(target.date, 1) : target.date, clockOut) : null;
    if (dayKind !== target.dayKind) payload.dayKind = dayKind;
    correct.mutate(payload, {
      onSuccess: () => {
        toast.success(`บันทึกการแก้ไขของ ${target.nickname} แล้ว`);
        onClose();
      },
      onError: (err: unknown) => {
        toast.error(getErrorMessage(err));
        // หน้าเปิดค้างมาก่อนมีการลงบัญชีใบเงินเดือน — snapshot เก่า ปิด dialog (hook โหลดแถวใหม่ให้แล้ว)
        if ((err as { response?: { data?: { code?: string } } })?.response?.data?.code === 'ATTENDANCE_PAID') onClose();
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>แก้ไขเวลา — {target.nickname} · {thaiShortDate(target.date)}</DialogTitle>
          <DialogDescription>ผจก.สาขา/เจ้าของ · ทุกการแก้เก็บค่าเก่า-ใหม่ ผู้แก้ และเหตุผล · สาย/OT คำนวณใหม่ด้วยกติกาเดียวกับตอนตอกจริง</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {paid && (
            <div id="corr-paid" className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm leading-snug">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{attendancePaidMessage(paid)}
            </div>
          )}
          {missingOut && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong leading-snug">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />ไม่ได้ตอกออก — ระบบปิดวันอัตโนมัติ 00:05 · OT ตอนนี้ = 0
            </div>
          )}
          {conflict && (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-snug">
              <span className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />เครื่องตอกบัตรถูกใช้ซ้อนช่วงเวลานี้ — ดูรูปและเวลาก่อนเชื่อรายการนี้
              </span>
              {isOwner ? (
                <Button variant="outline" size="sm" className="self-start max-lg:min-h-11 lg:h-9" onClick={markChecked} disabled={clearConflict.isPending}>
                  <ShieldCheck className="size-4" aria-hidden="true" />{clearConflict.isPending ? 'กำลังล้างธง…' : 'ตรวจแล้ว ล้างธง'}
                </Button>
              ) : (
                <span className="text-muted-foreground">การแก้เวลาไม่ล้างธงนี้ — เจ้าของต้องตรวจและล้างธงเอง</span>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="corr-in" className="text-sm font-medium">เข้างาน</label>
              <input id="corr-in" type="time" disabled={!!paid} aria-describedby={paid ? 'corr-paid' : undefined} value={clockIn} onChange={(e) => setClockIn(e.target.value)} className="h-11 lg:h-10 rounded-lg border border-input bg-background px-3 text-sm" />
              <span className="text-xs text-muted-foreground">เดิม: {originalIn || '—'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="corr-out" className="text-sm font-medium">ออกงาน</label>
              <input id="corr-out" type="time" disabled={!!paid} aria-describedby={paid ? 'corr-paid' : undefined} value={clockOut} onChange={(e) => setClockOut(e.target.value)} className="h-11 lg:h-10 rounded-lg border border-input bg-background px-3 text-sm" />
              <span className="text-xs text-muted-foreground">เดิม: {originalOut || '— (ไม่ได้ตอก)'}{outNextDay && ' · ออกหลังเที่ยงคืน (วันถัดไป)'}</span>
            </div>
          </div>
          {clearingIn && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong leading-snug">
              ล้างเวลาเข้า = ถือว่าไม่ได้มาทำงานวันนั้น (วันทำงานจะนับเป็นขาด){outWithoutIn && ' — ล้างเวลาออกด้วย'}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="corr-kind" className="text-sm font-medium">ประเภทวัน</label>
            <NativeSelect id="corr-kind" disabled={!!paid} aria-describedby={paid ? 'corr-paid' : undefined} value={dayKind} onChange={(e) => setDayKind(e.target.value as DayKind)}>
              {(Object.keys(DAY_KIND_LABEL) as DayKind[]).map((k) => <option key={k} value={k}>{DAY_KIND_LABEL[k]}</option>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="corr-reason" className="text-sm font-medium">เหตุผล (บังคับ ≥ {MIN_REASON} ตัวอักษร)</label>
            <textarea id="corr-reason" rows={2} disabled={!!paid} aria-describedby={paid ? 'corr-paid' : undefined} value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="max-lg:min-h-11">ยกเลิก</Button>
          <Button onClick={save} disabled={!canSave} aria-describedby={paid ? 'corr-paid' : undefined} className="max-lg:min-h-11">{correct.isPending ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

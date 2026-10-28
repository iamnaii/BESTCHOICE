import { useEffect, useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, KeyRound, Loader2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { usersApi } from '@/lib/api/users';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * บล็อก "รหัสตอกบัตร" บนหน้าผู้ใช้ — OWNER เท่านั้น (ก้อน 10 D3)
 * ระบบเก็บรหัสแบบ hash ดูย้อนหลังไม่ได้ ⇒ รีเซ็ตแล้วแสดงรหัสใหม่ครั้งเดียวในการ์ดนี้
 * สถานะ "มีรหัส" ถือในการ์ด (override props) — ห้าม invalidate `users.detail` เพราะหน้าจะ sync ฟอร์มทับค่าที่แก้ค้างไว้
 */

interface Props {
  userId: string;
  userName: string;
  hasPin: boolean;
}

export default function AttendancePinCard({ userId, userName, hasPin: hasPinProp }: Props) {
  const headingId = useId();
  const [hasPinOverride, setHasPinOverride] = useState<boolean | undefined>(undefined);
  const hasPin = hasPinOverride ?? hasPinProp;
  const [shownPin, setShownPin] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setHasPinOverride(undefined);
    setShownPin(null);
  }, [userId, hasPinProp]);

  const reset = useMutation({ mutationFn: () => usersApi.resetAttendancePin(userId) });

  const runReset = () =>
    reset.mutate(undefined, {
      onSuccess: (res) => {
        setShownPin(res.pin);
        setHasPinOverride(true);
        toast.success(`ตั้งรหัสตอกบัตรของ ${userName} แล้ว`);
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });

  return (
    <section aria-labelledby={headingId} className="bg-card rounded-xl border border-border/50 shadow-sm p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">รหัสตอกบัตร (ลงเวลา)</h2>
        {hasPin ? (
          <Badge variant="primary" appearance="light" size="sm">
            <CircleCheck className="size-3.5" aria-hidden="true" />
            มีรหัสแล้ว
          </Badge>
        ) : (
          <Badge variant="secondary" appearance="light" size="sm">ยังไม่มีรหัส</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground leading-snug">
        รหัส 6 หลักที่ {userName} ใช้ตอกเข้า-ออกงานที่เครื่องประจำสาขา — ระบบเก็บแบบเข้ารหัส ดูย้อนหลังไม่ได้ ลืมรหัสให้รีเซ็ตใหม่ที่นี่
      </p>

      {shownPin && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2" role="status">
          <div className="text-xs text-muted-foreground">รหัสตอกบัตรใหม่</div>
          <output className="block font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums">{shownPin}</output>
          <p className="text-sm leading-snug">
            <b>แสดงครั้งเดียว</b> — แจ้งรหัสให้ {userName} แล้วกดซ่อน · รหัสเดิม (ถ้ามี) ใช้ไม่ได้แล้ว
          </p>
          <Button variant="outline" size="sm" className="lg:h-9" onClick={() => setShownPin(null)}>ซ่อนรหัส</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="lg:h-9" onClick={() => (hasPin ? setConfirmReset(true) : runReset())} disabled={reset.isPending}>
          {reset.isPending ? (
            <><Loader2 className="size-4 animate-spin" aria-hidden="true" />กำลังตั้งรหัส…</>
          ) : (
            <><KeyRound className="size-4" aria-hidden="true" />{hasPin ? 'รีเซ็ตรหัส' : 'ตั้งรหัสตอกบัตร'}</>
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="รีเซ็ตรหัสตอกบัตร"
        description={`รหัสเดิมของ ${userName} จะใช้ตอกบัตรไม่ได้ทันที ระบบจะสุ่มรหัสใหม่ให้และแสดงครั้งเดียว`}
        confirmLabel="รีเซ็ต"
        onConfirm={runReset}
      />
    </section>
  );
}

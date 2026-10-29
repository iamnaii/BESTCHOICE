import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Ban, KeyRound, MonitorOff, Plus, Unlock } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAttendanceDeviceEvents, type AttendanceDevice, type AttendanceDeviceEventKind } from '@/hooks/useAttendance';
import { formatDeviceTime } from '../device.util';

const EVENT_VIEW: Record<AttendanceDeviceEventKind, { label: string; icon: LucideIcon; tone: string }> = {
  REGISTERED: { label: 'ลงทะเบียนเครื่อง', icon: Plus, tone: 'text-primary' },
  TOKEN_CONFLICT: { label: 'รหัสเครื่องถูกใช้จาก 2 ที่ — ล็อกเครื่อง', icon: AlertTriangle, tone: 'text-destructive' },
  PIN_LOCKOUT: { label: 'กรอกรหัสพนักงานผิด 5 ครั้ง — พักรหัส 15 นาที', icon: KeyRound, tone: 'text-warning-strong' },
  REVOKED: { label: 'ยกเลิกเครื่อง', icon: Ban, tone: 'text-muted-foreground' },
  UNLOCKED: { label: 'ปลดล็อก — ต้องลงทะเบียนใหม่', icon: Unlock, tone: 'text-muted-foreground' },
  OFFLINE: { label: 'ไม่ได้ติดต่อเกิน 24 ชั่วโมง', icon: MonitorOff, tone: 'text-warning-strong' },
};

interface Props {
  device: AttendanceDevice | null;
  onClose: () => void;
}

/** ประวัติเหตุการณ์ของเครื่อง (ลงทะเบียน/ชน/พักรหัส/ยกเลิก/ปลดล็อก/ขาดการติดต่อ) — ล่าสุด 50 รายการ */
export default function DeviceEventsSheet({ device, onClose }: Props) {
  const events = useAttendanceDeviceEvents(device?.id ?? null);
  return (
    <Sheet open={!!device} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>เหตุการณ์ — {device?.name}</SheetTitle>
          <SheetDescription>{device?.branchName} · ล่าสุด 50 รายการ</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <QueryBoundary isLoading={events.isLoading} isError={events.isError} error={events.error} onRetry={events.refetch} errorTitle="โหลดเหตุการณ์ไม่สำเร็จ">
            {(events.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีเหตุการณ์</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {(events.data ?? []).map((e) => {
                  const view = EVENT_VIEW[e.kind] ?? { label: e.kind, icon: AlertTriangle, tone: 'text-muted-foreground' };
                  const Icon = view.icon;
                  return (
                    <li key={e.id} className="flex items-start gap-3 py-3">
                      <Icon className={`mt-0.5 size-4 shrink-0 ${view.tone}`} aria-hidden="true" />
                      <div className="min-w-0 text-sm leading-snug">
                        <div className="font-medium">{view.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDeviceTime(e.createdAt)}{e.ip ? ` · IP ${e.ip}` : ''}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </QueryBoundary>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

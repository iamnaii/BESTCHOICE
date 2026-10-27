import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Plus, Tablet } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAttendanceDevices, useAttendanceSettings, useDeviceAction, type AttendanceDevice } from '@/hooks/useAttendance';
import { hhmm } from '@/pages/attendance/attendance.util';
import RegistrationCodeDialog from './components/RegistrationCodeDialog';
import DeviceEventsSheet from './components/DeviceEventsSheet';
import WorkHoursForm from './components/WorkHoursForm';
import { deviceKind, deviceStatusView, formatDeviceTime, formatRegisteredDate, pinLockedUntil } from './device.util';

/**
 * ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร (ก้อน 10 D3 · mockup บอร์ด 4) — OWNER
 * เพิ่มเครื่อง = ออกรหัส 8 ตัวให้กรอกที่ /kiosk · ยกเลิก = เครื่องตอกไม่ได้ทันที · ปลดล็อก = ยกเลิก + ต้องลงทะเบียนใหม่
 * ด้านล่าง: เวลางานค่าระบบ + ตั้งทับรายสาขา + ผ่อนผันสาย + อายุเก็บรูป
 */
type Pending = { device: AttendanceDevice; action: 'revoke' | 'unlock' };

export default function AttendanceDevicesPage() {
  useDocumentTitle('เครื่องตอกบัตร');
  const devices = useAttendanceDevices();
  const settings = useAttendanceSettings();
  const deviceAction = useDeviceAction();
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [eventsOf, setEventsOf] = useState<AttendanceDevice | null>(null);

  const runAction = () => {
    if (!pending) return;
    const { device, action } = pending;
    deviceAction.mutate(
      { id: device.id, action },
      {
        onSuccess: () => toast.success(action === 'revoke' ? `ยกเลิกเครื่อง ${device.name} แล้ว` : `ปลดล็อกแล้ว — ลงทะเบียน ${device.name} ใหม่ด้วยปุ่ม เพิ่มเครื่อง`),
        onError: (err: unknown) => toast.error(getErrorMessage(err)),
      },
    );
  };

  const closeAdd = (open: boolean) => {
    setAddOpen(open);
    if (!open) void devices.refetch();
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="เครื่องตอกบัตร"
        subtitle="แท็บเล็ตประจำสาขาที่พนักงานตอกเข้า-ออก · ตอกจากเครื่องอื่นไม่ได้"
        icon={<Tablet className="size-5" aria-hidden="true" />}
        action={
          <Button onClick={() => setAddOpen(true)} disabled={!settings.data?.branches.length} className="max-lg:min-h-11">
            <Plus className="size-4" aria-hidden="true" />เพิ่มเครื่อง
          </Button>
        }
      />

      <QueryBoundary isLoading={devices.isLoading} isError={devices.isError} error={devices.error} onRetry={devices.refetch} errorTitle="โหลดรายการเครื่องไม่สำเร็จ">
        {(devices.data ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">ยังไม่มีเครื่อง — กด เพิ่มเครื่อง แล้วกรอกรหัสบนแท็บเล็ตของสาขา</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" aria-label="รายการเครื่องตอกบัตร">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">เครื่อง</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">สาขา</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">สถานะ</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">ติดต่อล่าสุด</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium"><span className="sr-only">การทำงาน</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(devices.data ?? []).map((d) => {
                    const view = deviceStatusView(d);
                    const Icon = view.icon;
                    const pinLock = pinLockedUntil(d);
                    return (
                      <tr key={d.id} className="align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium">{d.name}</div>
                          <div className="text-xs text-muted-foreground">{deviceKind(d.lastUserAgent)} · ลงทะเบียน {formatRegisteredDate(d.createdAt)}</div>
                        </td>
                        <td className="px-4 py-3">{d.branchName}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium leading-snug ${view.className}`}>
                              <Icon className="size-3.5 shrink-0" aria-hidden="true" />{view.label}
                            </span>
                            {pinLock && (
                              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium leading-snug text-warning-strong">
                                <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />พักรหัสพนักงานถึง {hhmm(pinLock)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDeviceTime(d.lastSeenAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="outline" size="sm" className="max-lg:min-h-11" onClick={() => setEventsOf(d)}>ดูเหตุการณ์</Button>
                            {d.status === 'ACTIVE' && (
                              <Button variant="outline" size="sm" className="text-destructive max-lg:min-h-11" onClick={() => setPending({ device: d, action: 'revoke' })}>ยกเลิก</Button>
                            )}
                            {d.status === 'LOCKED' && (
                              <Button variant="outline" size="sm" className="max-lg:min-h-11" onClick={() => setPending({ device: d, action: 'unlock' })}>ปลดล็อก</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </QueryBoundary>

      <QueryBoundary isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={settings.refetch} errorTitle="โหลดเวลางานไม่สำเร็จ">
        {settings.data && <WorkHoursForm initial={settings.data} />}
      </QueryBoundary>

      <RegistrationCodeDialog open={addOpen} onOpenChange={closeAdd} branches={settings.data?.branches ?? []} />
      <DeviceEventsSheet device={eventsOf} onClose={() => setEventsOf(null)} />
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => { if (!o) setPending(null); }}
        title={pending?.action === 'revoke' ? 'ยกเลิกเครื่องตอกบัตร' : 'ปลดล็อกเครื่อง'}
        description={
          pending?.action === 'revoke'
            ? `${pending.device.name} จะตอกบัตรไม่ได้ทันที ถ้าจะใช้เครื่องนี้อีกต้องลงทะเบียนใหม่ด้วยรหัสจากปุ่ม เพิ่มเครื่อง`
            : `ระบบจะยกเลิกรหัสเครื่องเดิมทั้งหมด (กันเครื่องที่ถือรหัสซ้ำใช้ต่อ) แล้วต้องลงทะเบียน ${pending?.device.name ?? ''} ใหม่ด้วยรหัสจากปุ่ม เพิ่มเครื่อง · รายการลงเวลาช่วงที่ถูกใช้ซ้อนติดธง "เครื่องถูกใช้ซ้อน" — ตรวจและล้างธงที่เมนู ลงเวลา › แก้ไข`
        }
        confirmLabel={pending?.action === 'revoke' ? 'ยกเลิกเครื่อง' : 'ปลดล็อก'}
        variant={pending?.action === 'revoke' ? 'destructive' : 'default'}
        onConfirm={runAction}
      />
    </div>
  );
}

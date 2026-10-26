import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { thaiTime } from '@/components/appointments/types';
import {
  appointmentControlClass,
  appointmentFieldClass,
} from '@/components/appointments/field-styles';
interface Window {
  id: string;
  staffUserId: string;
  startsAt: string;
  endsAt: string;
  version: number;
  staff: { name: string };
}
export default function Schedule({
  branchId,
  day,
  staff,
}: {
  branchId: string;
  day: string;
  staff: { id: string; name: string; branchId: string }[];
}) {
  const qc = useQueryClient();
  const [copyDay, setCopyDay] = useState('');
  const [employee, setEmployee] = useState(''),
    [start, setStart] = useState('10:00'),
    [end, setEnd] = useState('19:15');
  const [edit, setEdit] = useState<Window | null>(null);
  const windows = useQuery({
    queryKey: ['appointments', 'windows', branchId, day],
    queryFn: () =>
      api
        .get<Window[]>('/store-appointments/windows', { params: { branchId, day } })
        .then((r) => r.data),
    enabled: !!branchId,
  });
  const mutation = useMutation({
    mutationFn: async (input: { action: 'save' | 'delete' | 'copy'; window?: Window }) => {
      const w = input.window;
      if (input.action === 'delete' && w)
        return api.delete(`/store-appointments/windows/${w.id}`, { data: { version: w.version } });
      if (input.action === 'copy')
        return api.post('/store-appointments/windows/copy', {
          branchId,
          fromDay: day,
          toDay: copyDay,
        });
      return api.post('/store-appointments/windows', {
        branchId,
        staffUserId: employee,
        startsAt: `${day}T${start}:00+07:00`,
        endsAt: `${day}T${end}:00+07:00`,
        ...(edit ? { id: edit.id, version: edit.version } : {}),
      });
    },
    onSuccess: () => {
      toast.success('บันทึกตารางแล้ว');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-semibold">ตารางพนักงานรับนัด</h2>
      <p className="text-sm text-muted-foreground">
        ระบุช่วงที่รับนัดได้จริง เว้นช่วงพักด้วยการแยกช่วงเวลา คิวสุดท้ายเริ่ม 18:30 น.
        ต้องมีพนักงานถึง 19:15 น.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({ action: 'save' });
        }}
      >
        <label className={`${appointmentFieldClass} w-full sm:w-64`}>
          <span>พนักงาน</span>
          <NativeSelect
            aria-label="พนักงานรับนัด"
            required
            value={employee}
            disabled={!!edit}
            onChange={(e) => setEmployee(e.target.value)}
            className={appointmentControlClass}
          >
            <option value="">เลือกพนักงาน</option>
            {staff
              .filter((s) => s.branchId === branchId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </NativeSelect>
        </label>
        <label className={`${appointmentFieldClass} w-full sm:w-40`}>
          <span>เริ่ม</span>
          <Input
            className={appointmentControlClass}
            aria-label="เริ่มรับนัด"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </label>
        <label className={`${appointmentFieldClass} w-full sm:w-40`}>
          <span>สิ้นสุด</span>
          <Input
            className={appointmentControlClass}
            aria-label="สิ้นสุดรับนัด"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </label>
        <Button className="min-h-11" disabled={mutation.isPending || !branchId || !employee}>
          {edit ? 'บันทึกการแก้ไข' : 'เพิ่มช่วงเวลา'}
        </Button>
        {edit && (
          <Button type="button" variant="ghost" onClick={() => setEdit(null)}>
            เลิกแก้ไข
          </Button>
        )}
      </form>
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${appointmentFieldClass} w-full sm:w-64`}>
          <span>คัดลอกตารางวันนี้ไปวันที่</span>
          <Input
            className={appointmentControlClass}
            aria-label="วันที่ปลายทาง"
            type="date"
            value={copyDay}
            onChange={(e) => setCopyDay(e.target.value)}
          />
        </label>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={!branchId || !copyDay || mutation.isPending}
          onClick={() => mutation.mutate({ action: 'copy' })}
        >
          คัดลอกทั้งวัน
        </Button>
      </div>
      {windows.isError ? (
        <p role="alert">
          โหลดตารางไม่ได้{' '}
          <Button variant="outline" onClick={() => void windows.refetch()}>
            ลองใหม่
          </Button>
        </p>
      ) : windows.isLoading ? (
        <p role="status">กำลังโหลดตาราง…</p>
      ) : (
        <ul className="divide-y divide-border">
          {windows.data?.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                {w.staff.name} · {thaiTime(w.startsAt)}–{thaiTime(w.endsAt)}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setEdit(w);
                    setEmployee(w.staffUserId);
                    setStart(thaiTime(w.startsAt));
                    setEnd(thaiTime(w.endsAt));
                  }}
                >
                  แก้ไข
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ action: 'delete', window: w })}
                >
                  ลบช่วงเวลา
                </Button>
              </div>
            </li>
          ))}
          {windows.data?.length === 0 && (
            <li className="py-3 text-sm text-muted-foreground">ยังไม่มีตารางรับนัดในวันนี้</li>
          )}
        </ul>
      )}
    </section>
  );
}

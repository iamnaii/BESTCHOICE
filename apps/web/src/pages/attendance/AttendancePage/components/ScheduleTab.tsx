import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import QueryBoundary from '@/components/QueryBoundary';
import NameWords from '@/components/ui/NameWords';
import { useAttendanceMonth, useSetDayKinds, type DayKind } from '@/hooks/useAttendance';
import { DAY_KIND_LABEL, nextDayKind, shiftDate, thaiShortDate, todayBangkok } from '../../attendance.util';

interface Props {
  branchId: string;
  weekStart: string; // จันทร์ YYYY-MM-DD
  onWeekChange: (next: string) => void;
  actorId: string;
  isOwner: boolean;
}

const KIND_CLASS: Record<DayKind, string> = {
  WORK: 'border-input bg-background text-foreground',
  DAY_OFF: 'border-border bg-muted text-muted-foreground font-semibold',
  LEAVE_SICK: 'border-info/30 bg-info/10 text-info font-semibold',
  LEAVE_PERSONAL: 'border-info/30 bg-info/10 text-info font-semibold',
  LEAVE_OTHER: 'border-info/30 bg-info/10 text-info font-semibold',
  SHOP_CLOSED: 'border-destructive/30 bg-destructive/10 text-destructive font-semibold',
};

/**
 * ตารางหยุด/ลา รายสัปดาห์ — กดช่องเพื่อสลับประเภทวัน แล้วบันทึกเฉพาะช่องที่เปลี่ยน (PUT /attendance/day-kinds)
 * วางแผนล่วงหน้าเท่านั้น: วันที่ผ่านไปแล้วล็อก (ลา/หยุดย้อนหลังต้องมีเหตุผล — แท็บวันนี้ › แก้ไข · สเปก §6 · รีวิว I2)
 * ผจก.แก้ได้เฉพาะพนักงานของสาขาตัวเอง (แถวพนักงานสาขาอื่นที่มาช่วยล็อก)
 */
export default function ScheduleTab({ branchId, weekStart, onWeekChange, actorId, isOwner }: Props) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i)), [weekStart]);
  const months = useMemo(() => Array.from(new Set(days.map((d) => d.slice(0, 7)))), [days]);
  const first = useAttendanceMonth(branchId, months[0]);
  const second = useAttendanceMonth(months.length > 1 ? branchId : undefined, months[1] ?? '');
  const setKinds = useSetDayKinds();
  const [pending, setPending] = useState<Record<string, DayKind>>({}); // key = userId|date

  const rows = useMemo(() => {
    const byUser = new Map<string, { userId: string; nickname: string; name: string; role: string; visiting: boolean; kinds: Record<string, DayKind> }>();
    for (const src of [first.data, second.data]) {
      for (const r of src?.rows ?? []) {
        const entry = byUser.get(r.userId) ?? { userId: r.userId, nickname: r.nickname, name: r.name, role: r.role, visiting: r.visiting, kinds: {} };
        for (const d of days) if (r.cells[d]) entry.kinds[d] = r.cells[d].dayKind;
        byUser.set(r.userId, entry);
      }
    }
    return [...byUser.values()];
  }, [first.data, second.data, days]);

  const today = todayBangkok();
  const kindOf = (userId: string, date: string, base: DayKind | undefined) => pending[`${userId}|${date}`] ?? base ?? 'WORK';
  const changes = Object.entries(pending).map(([k, dayKind]) => { const [userId, date] = k.split('|'); return { userId, date, dayKind }; });

  const save = () => {
    if (!changes.length) return;
    setKinds.mutate({ branchId, entries: changes }, {
      onSuccess: () => { toast.success(`บันทึกตารางแล้ว ${changes.length} รายการ`); setPending({}); },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });
  };

  const loading = (first.isLoading && !first.data) || (months.length > 1 && second.isLoading && !second.data);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="lg:size-9" aria-label="สัปดาห์ก่อน" onClick={() => onWeekChange(shiftDate(weekStart, -7))}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <div className="text-base font-semibold">{thaiShortDate(days[0])} – {thaiShortDate(days[6])}</div>
          <Button variant="outline" size="sm" className="lg:size-9" aria-label="สัปดาห์ถัดไป" onClick={() => onWeekChange(shiftDate(weekStart, 7))}><ChevronRight className="size-4" aria-hidden="true" /></Button>
        </div>
        <span className="text-xs text-muted-foreground">หยุดสัปดาห์ละ 1 วันสลับกัน · ไม่มีตาราง = ทุกวันเป็นวันทำงาน (ไม่มา = ขาด) · กดช่องเพื่อสลับ ทำงาน → หยุด → ลาป่วย → ลากิจ → ร้านปิด</span>
      </div>

      <QueryBoundary isLoading={loading} isError={first.isError} error={first.error} onRetry={first.refetch} errorTitle="โหลดตารางไม่สำเร็จ">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm" aria-label="ตารางหยุด/ลา รายสัปดาห์">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">พนักงาน</th>
                  {days.map((d) => <th key={d} className="px-1 py-2 text-center font-medium">{thaiShortDate(d)}</th>)}
                  <th className="px-2 py-2 text-left font-medium">หยุดสัปดาห์นี้</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const self = !isOwner && r.userId === actorId;
                  const otherBranch = !isOwner && r.visiting;
                  const locked = self || otherBranch;
                  const offCount = days.filter((d) => kindOf(r.userId, d, r.kinds[d]) === 'DAY_OFF').length;
                  return (
                    <tr key={r.userId} className="border-t border-border">
                      <td className="px-3 py-1.5"><div className="font-semibold leading-snug">{r.nickname}</div><div className="text-xs text-muted-foreground leading-snug"><NameWords name={r.name} />{self && ' · ตารางของตัวเอง ให้เจ้าของแก้'}{otherBranch && ' · พนักงานสาขาอื่น ให้สาขานั้นกำหนด'}</div></td>
                      {days.map((d) => {
                        const kind = kindOf(r.userId, d, r.kinds[d]);
                        const dirty = `${r.userId}|${d}` in pending;
                        const past = d < today;
                        return (
                          <td key={d} className="px-1 py-1.5">
                            <button
                              type="button"
                              disabled={locked || past || setKinds.isPending}
                              title={past ? 'ผ่านไปแล้ว — บันทึกลา/หยุดย้อนหลังที่แท็บ วันนี้ › แก้ไข' : undefined}
                              onClick={() => setPending((p) => ({ ...p, [`${r.userId}|${d}`]: nextDayKind(kind) }))}
                              className={`h-11 w-full rounded-lg border text-xs ${KIND_CLASS[kind]} ${dirty ? 'ring-2 ring-primary/40' : ''} disabled:opacity-60`}
                              aria-label={`${r.nickname} ${thaiShortDate(d)}: ${DAY_KIND_LABEL[kind]}`}
                            >
                              {DAY_KIND_LABEL[kind]}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${offCount >= 1 ? 'border-primary/30 bg-primary/10 text-primary' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>{offCount >= 1 ? `${offCount} วัน` : 'ยังไม่กำหนด'}</span>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && !loading && <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">ยังไม่มีพนักงานในสาขานี้</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2">
            <span className="text-xs text-muted-foreground leading-snug">วันที่ผ่านไปแล้วล็อก — บันทึกลา/หยุดย้อนหลังที่แท็บ วันนี้ (เลือกวันที่) › แก้ไข พร้อมเหตุผล · เปลี่ยน {changes.length} ช่อง</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="lg:h-9" disabled={!changes.length} onClick={() => setPending({})}>ยกเลิกที่แก้</Button>
              <Button size="sm" className="lg:h-9" disabled={!changes.length || setKinds.isPending} onClick={save}>บันทึกตาราง</Button>
            </div>
          </div>
        </div>
      </QueryBoundary>
    </div>
  );
}

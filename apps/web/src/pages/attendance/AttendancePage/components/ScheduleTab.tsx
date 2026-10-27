import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import QueryBoundary from '@/components/QueryBoundary';
import { useAttendanceMonth, useSetDayKinds, type DayKind } from '@/hooks/useAttendance';
import { PaidChip } from './PaidLock';
import { DAY_KIND_LABEL, attendancePaidMessage, nextDayKind, shiftDate, thaiMonthLabel, thaiShortDate, todayBangkok } from '../../attendance.util';

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
    const byUser = new Map<string, { userId: string; nickname: string; name: string; role: string; visiting: boolean; kinds: Record<string, DayKind>; paid: Record<string, string> }>();
    for (const src of [first.data, second.data]) {
      for (const r of src?.rows ?? []) {
        const entry = byUser.get(r.userId) ?? { userId: r.userId, nickname: r.nickname, name: r.name, role: r.role, visiting: r.visiting, kinds: {}, paid: {} };
        if (r.paidDocumentNumber && src?.month) entry.paid[src.month] = r.paidDocumentNumber; // เดือนที่จ่ายแล้ว → เลขที่ใบ
        for (const d of days) if (r.cells[d]) entry.kinds[d] = r.cells[d].dayKind;
        byUser.set(r.userId, entry);
      }
    }
    return [...byUser.values()];
  }, [first.data, second.data, days]);

  const today = todayBangkok();
  const kindOf = (userId: string, date: string, base: DayKind | undefined) => pending[`${userId}|${date}`] ?? base ?? 'WORK';
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // เจ้าของเปลี่ยนสาขา: ช่องที่แก้ค้างเป็นของพนักงานสาขาเดิม — ทิ้ง ไม่ส่งไปกับสาขาใหม่
  const prevBranch = useRef(branchId);
  useEffect(() => {
    if (prevBranch.current === branchId) return;
    prevBranch.current = branchId;
    const n = Object.keys(pendingRef.current).length;
    if (!n) return;
    setPending({});
    toast.warning(`ทิ้งการแก้ ${n} ช่อง เพราะเปลี่ยนสาขา`);
  }, [branchId]);

  const paidNo = (userId: string, date: string) => rows.find((r) => r.userId === userId)?.paid[date.slice(0, 7)];
  const changes = Object.entries(pending)
    .map(([k, dayKind]) => { const [userId, date] = k.split('|'); return { userId, date, dayKind }; })
    .filter((c) => !paidNo(c.userId, c.date)); // ช่องของเดือนที่จ่ายแล้วไม่ส่ง (ไม่งั้นทั้งชุดโดน 409)

  // มีคนถูกลงบัญชีใบเงินเดือนระหว่างที่แก้ค้าง: ทิ้งเฉพาะช่องที่ล็อกแล้ว เก็บที่เหลือ แล้วบอกจำนวน
  useEffect(() => {
    const dropped = Object.keys(pending).filter((k) => { const [u, d] = k.split('|'); return !!paidNo(u, d); });
    if (!dropped.length) return;
    setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !dropped.includes(k))));
    toast.warning(`ทิ้งการแก้ ${dropped.length} ช่อง เพราะเดือนนั้นจ่ายเงินเดือนแล้ว`);
  }, [rows, pending]);

  const save = () => {
    if (!changes.length) return;
    setKinds.mutate({ branchId, entries: changes }, {
      onSuccess: () => { toast.success(`บันทึกตารางแล้ว ${changes.length} รายการ`); setPending({}); },
      onError: (err: unknown) => {
        toast.error(getErrorMessage(err));
        // 409 ATTENDANCE_PAID: เดือนที่เปิดอยู่ตัดช่องที่จ่ายแล้วทิ้งเองหลังโหลดใหม่ · เดือนที่ไม่ได้โหลด (สัปดาห์อื่น) เช็คไม่ได้ → ทิ้งช่องของเดือนนั้นด้วย
        if ((err as { response?: { data?: { code?: string } } })?.response?.data?.code !== 'ATTENDANCE_PAID') return;
        const loaded = new Set([first.data?.month, second.data?.month].filter(Boolean));
        const drop = Object.keys(pendingRef.current).filter((k) => !loaded.has(k.split('|')[1].slice(0, 7)));
        if (!drop.length) return;
        setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !drop.includes(k))));
        toast.warning(`ทิ้งการแก้ ${drop.length} ช่องของเดือนที่ไม่ได้เปิดอยู่ เพราะมีเดือนที่จ่ายเงินเดือนแล้ว`);
      },
    });
  };

  const secondFailed = months.length > 1 && second.isError && !second.data;
  const loading = (first.isLoading && !first.data) || (months.length > 1 && second.isLoading && !second.data);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label="สัปดาห์ก่อน" onClick={() => onWeekChange(shiftDate(weekStart, -7))}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <div className="text-base font-semibold">{thaiShortDate(days[0])} – {thaiShortDate(days[6])}</div>
          <Button variant="outline" size="sm" aria-label="สัปดาห์ถัดไป" onClick={() => onWeekChange(shiftDate(weekStart, 7))}><ChevronRight className="size-4" aria-hidden="true" /></Button>
        </div>
        <span className="text-xs text-muted-foreground">หยุดสัปดาห์ละ 1 วันสลับกัน · ไม่มีตาราง = ทุกวันเป็นวันทำงาน (ไม่มา = ขาด) · กดช่องเพื่อสลับ ทำงาน → หยุด → ลาป่วย → ลากิจ → ร้านปิด</span>
      </div>

      {secondFailed && (
        <p id="sched-month-unknown" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm leading-snug text-warning-strong">
          โหลดข้อมูลเดือน {thaiMonthLabel(months[1])} ไม่สำเร็จ — ยังไม่รู้ว่าจ่ายเงินเดือนแล้วหรือยัง จึงแก้ช่องของเดือนนั้นไม่ได้
          <Button variant="outline" size="sm" onClick={() => void second.refetch()}>ลองใหม่</Button>
        </p>
      )}
      <QueryBoundary isLoading={loading} isError={first.isError} error={first.error} onRetry={first.refetch} errorTitle="โหลดตารางไม่สำเร็จ">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
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
                      <td className="px-3 py-1.5">
                        <div className="font-semibold leading-snug">{r.nickname}</div>
                        <div className="text-xs text-muted-foreground leading-snug">{r.name}{self && ' · ตารางของตัวเอง ให้เจ้าของแก้'}{otherBranch && ' · พนักงานสาขาอื่น ให้สาขานั้นกำหนด'}</div>
                        {Object.entries(r.paid).map(([m, no]) => (
                          <div key={m} className="mt-1 flex flex-wrap items-center gap-1"><PaidChip id={`sched-paid-${r.userId}-${m}`} number={no} /><span className="text-xs text-muted-foreground leading-snug">เดือน {thaiMonthLabel(m)}</span></div>
                        ))}
                      </td>
                      {days.map((d) => {
                        const kind = kindOf(r.userId, d, r.kinds[d]);
                        const dirty = `${r.userId}|${d}` in pending;
                        const past = d < today;
                        const paidNum = r.paid[d.slice(0, 7)];
                        const unknown = secondFailed && d.slice(0, 7) === months[1]; // เดือนที่โหลดไม่สำเร็จ = ไม่รู้ว่าจ่ายแล้วหรือยัง
                        const paidId = paidNum ? `sched-paid-${r.userId}-${d.slice(0, 7)}` : unknown ? 'sched-month-unknown' : undefined;
                        return (
                          <td key={d} className="px-1 py-1.5">
                            <button
                              type="button"
                              disabled={locked || past || !!paidNum || unknown || setKinds.isPending}
                              aria-describedby={paidId}
                              title={paidNum ? attendancePaidMessage(paidNum) : past ? 'ผ่านไปแล้ว — บันทึกลา/หยุดย้อนหลังที่แท็บ วันนี้ › แก้ไข' : undefined}
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
            <span className="text-xs text-muted-foreground leading-snug">วันที่ผ่านไปแล้วล็อก — บันทึกลา/หยุดย้อนหลังที่แท็บ วันนี้ (เลือกวันที่) › แก้ไข พร้อมเหตุผล (ยกเว้นเดือนที่จ่ายเงินเดือนแล้ว) · เปลี่ยน {changes.length} ช่อง</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!changes.length} onClick={() => setPending({})}>ยกเลิกที่แก้</Button>
              <Button size="sm" className="max-lg:min-h-11" disabled={!changes.length || setKinds.isPending} onClick={save}>บันทึกตาราง</Button>
            </div>
          </div>
        </div>
      </QueryBoundary>
    </div>
  );
}

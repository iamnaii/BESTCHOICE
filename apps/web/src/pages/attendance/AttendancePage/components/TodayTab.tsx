import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import QueryBoundary from '@/components/QueryBoundary';
import { useAttendanceToday, type TodayRow } from '@/hooks/useAttendance';
import StatusChip from './StatusChip';
import PhotoThumb from './PhotoThumb';
import { FLAG_LABEL, flagChipClass, fmtOt, hhmm, shiftDate, thaiShortDate } from '../../attendance.util';
import type { CorrectTarget } from './CorrectDayDialog';
import { PaidBanner, PaidChip, UnpaidChip, distinctNumbers } from './PaidLock';

interface Props {
  branchId: string;
  date: string; // '' = วันนี้
  onDateChange: (next: string) => void;
  actorId: string;
  isOwner: boolean;
  onEdit: (target: CorrectTarget) => void;
}

const KPI: Array<{ key: keyof ReturnType<typeof kpiView>; label: string }> = [];
function kpiView(k: { staff: number; present: number; onTime: number; late: number; absentSoFar: number; off: number; leave: number; flagged: number }) {
  return {
    staff: { label: 'พนักงานวันนี้', value: k.staff, sub: `หยุด/ลา ${k.off + k.leave} คน`, tone: '' },
    present: { label: 'มาแล้ว', value: k.present, sub: `ตรงเวลา ${k.onTime}`, tone: 'text-primary' },
    late: { label: 'สาย', value: k.late, sub: '', tone: 'text-warning-strong' },
    absent: { label: 'ยังไม่มา', value: k.absentSoFar, sub: 'ไม่มีวันหยุด/ลา', tone: 'text-destructive' },
    flagged: { label: 'ผิดปกติ', value: k.flagged, sub: 'ไม่มีรูป / เครื่องซ้อน / ลืมออก', tone: '' },
  };
}
void KPI;

export default function TodayTab({ branchId, date, onDateChange, actorId, isOwner, onEdit }: Props) {
  const today = useAttendanceToday(branchId, date);
  const data = today.data;
  const shownDate = data?.date ?? date;
  const elsewhere = (row: TodayRow) => !!row.dayBranchId && row.dayBranchId !== branchId;
  const canEdit = (row: TodayRow) => !!row.dayId && (isOwner || (row.userId !== actorId && !elsewhere(row)));
  // เดือนที่จ่ายเงินเดือนแล้ว: แก้เวลา/ประเภทวันไม่ได้ · ยกเว้นเจ้าของที่ยังล้างธง "เครื่องถูกใช้ซ้อน" ได้ (ปุ่มเปิด dialog ได้เฉพาะกรณีนั้น)
  const paidLocked = (row: TodayRow) => !!row.paidDocumentNumber && !(isOwner && row.flags.includes('DEVICE_CONFLICT'));
  const paidRows = (data?.rows ?? []).filter((r) => r.paidDocumentNumber);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label="วันก่อนหน้า" onClick={() => onDateChange(shiftDate(shownDate, -1))}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <div className="text-base font-semibold">{shownDate ? thaiShortDate(shownDate) : 'วันนี้'}</div>
          <Button variant="outline" size="sm" aria-label="วันถัดไป" onClick={() => onDateChange(shiftDate(shownDate, 1))}><ChevronRight className="size-4" aria-hidden="true" /></Button>
          {date && <Button variant="ghost" size="sm" onClick={() => onDateChange('')}>วันนี้</Button>}
          {data && <span className="text-xs text-muted-foreground">เวลางาน {data.rules.workStart}–{data.rules.workEnd} · ผ่อนผันสาย {data.rules.lateGraceMinutes} นาที · OT เริ่มนับหลังเลิกงาน 15 นาที</span>}
        </div>
      </div>

      <QueryBoundary isLoading={today.isLoading && !data} isError={today.isError} error={today.error} onRetry={today.refetch} errorTitle="โหลดข้อมูลวันนี้ไม่สำเร็จ">
        {data && (
          <>
            <ul role="list" aria-label="สรุปวันนี้" className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {Object.values(kpiView(data.kpi)).map((k) => (
                <li key={k.label} className="flex flex-col gap-0.5 rounded-xl border border-border bg-card px-4 py-3">
                  <span className="text-xs text-muted-foreground">{k.label}</span>
                  <b className={`text-2xl font-bold leading-tight ${k.tone}`}>{k.value}</b>
                  {k.sub && <span className="text-xs text-muted-foreground">{k.sub}</span>}
                </li>
              ))}
            </ul>

            <PaidBanner month={shownDate.slice(0, 7)} numbers={distinctNumbers(paidRows)} people={paidRows.length} />

            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm" aria-label="รายการวันนี้">
                  <thead className="bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">รูป</th>
                      <th className="px-3 py-2 text-left font-medium">พนักงาน</th>
                      <th className="px-3 py-2 text-left font-medium">สถานะ</th>
                      <th className="px-3 py-2 text-left font-medium">เข้า</th>
                      <th className="px-3 py-2 text-left font-medium">ออก</th>
                      <th className="px-3 py-2 text-left font-medium">OT</th>
                      <th className="px-3 py-2 text-left font-medium">หมายเหตุ / ธง</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.userId} className={`border-t border-border ${row.status === 'NOT_IN' || row.status === 'DAY_OFF' || row.status === 'SHOP_CLOSED' ? 'bg-muted/40' : ''}`}>
                        <td className="px-3 py-2"><PhotoThumb punchId={row.clockInPunchId} label={row.nickname} /></td>
                        <td className="px-3 py-2">
                          <div className="font-semibold leading-snug">{row.nickname}{row.visiting && <span className="ml-1 text-xs font-normal text-muted-foreground">(มาช่วยสาขา)</span>}</div>
                          <div className="text-xs text-muted-foreground leading-snug">{row.name}</div>
                        </td>
                        <td className="px-3 py-2"><StatusChip status={row.status} lateMinutes={row.lateMinutes} /></td>
                        <td className="px-3 py-2 tabular-nums">{hhmm(row.clockIn)}</td>
                        <td className="px-3 py-2 tabular-nums">{row.status === 'MISSING_OUT' ? <span className="text-xs text-muted-foreground">ปิดอัตโนมัติ 00:05</span> : hhmm(row.clockOut)}</td>
                        <td className="px-3 py-2 tabular-nums">{row.otHours > 0 ? `${fmtOt(row.otHours)} ชม.` : '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {row.flags.filter((f) => f !== 'MISSING_OUT').map((f) => {
                              const v = FLAG_LABEL[f];
                              if (!v) return null;
                              const Icon = v.icon;
                              return <span key={f} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${flagChipClass(f)}`}><Icon className="size-3" aria-hidden="true" />{v.label}</span>;
                            })}
                            {row.paidDocumentNumber ? <PaidChip id={`paid-${row.userId}`} number={row.paidDocumentNumber} /> : paidRows.length > 0 && row.dayId ? <UnpaidChip editable={canEdit(row)} /> : null}
                            {!row.hasPin && <span className="text-xs text-muted-foreground">{isOwner ? 'ตั้งรหัสที่หน้าผู้ใช้ › รหัสตอกบัตร' : 'ให้เจ้าของตั้งรหัสตอกบัตร'}</span>}
                            {!isOwner && elsewhere(row) && <span className="text-xs text-muted-foreground">ตอกที่สาขาอื่น — ให้ผู้จัดการสาขานั้นหรือเจ้าของแก้</span>}
                            {row.status === 'NOT_IN' && row.hasPin && <span className="text-xs text-muted-foreground">ถ้าไม่มาทั้งวันจะนับขาดตอนเที่ยงคืน</span>}
                            {row.status === 'MISSING_OUT' && <span className="text-xs text-muted-foreground">ถ้าทำ OT จริง แก้เวลาออกพร้อมเหตุผล</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canEdit(row) && (
                            <Button variant="outline" size="sm" className="max-lg:min-h-11" disabled={paidLocked(row)} aria-describedby={paidLocked(row) ? `paid-${row.userId}` : undefined} onClick={() => onEdit({ dayId: row.dayId!, nickname: row.nickname, date: shownDate, clockIn: row.clockIn, clockOut: row.clockOut, dayKind: row.dayKind, flags: row.flags, paidDocumentNumber: row.paidDocumentNumber })}>แก้ไข</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

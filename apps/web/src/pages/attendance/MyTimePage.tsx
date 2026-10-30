import { useState } from 'react';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAttendanceMe, type MeResult } from '@/hooks/useAttendance';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import StatusChip from './AttendancePage/components/StatusChip';
import { DAY_KIND_LABEL, fmtOt, hhmm, shiftMonth, thaiMonthLabel, thaiShortDate, todayBangkok } from './attendance.util';

/**
 * เวลาทำงานของฉัน (ก้อน 10 D3 · mockup บอร์ด 5) — ทุก role · อ่านอย่างเดียว
 * ข้อมูลไม่ตรงให้แจ้งผู้จัดการสาขาแก้ที่หน้า "ลงเวลา" (มีประวัติทุกครั้ง)
 */
type MeRow = MeResult['rows'][number];

function rowDetail(row: MeRow, today: string): string {
  if (row.dayKind === 'DAY_OFF') return 'วันหยุดประจำสัปดาห์';
  if (row.dayKind === 'SHOP_CLOSED') return 'ร้านปิดทั้งสาขา';
  if (row.dayKind !== 'WORK') return `${DAY_KIND_LABEL[row.dayKind]} · บันทึกโดย ผจก.`;
  if (!row.clockIn) return row.date === today ? 'ยังไม่ได้ตอกเข้า' : 'ไม่มีการตอกบัตร';
  const out = row.clockOut ? `ออก ${hhmm(row.clockOut)}` : row.date === today ? 'ยังไม่ออก' : 'ไม่ได้ตอกออก';
  return `เข้า ${hhmm(row.clockIn)} · ${out}`;
}

export default function MyTimePage() {
  useDocumentTitle('เวลาทำงานของฉัน');
  const today = todayBangkok();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const me = useAttendanceMe(month);
  const isCurrentMonth = month === today.slice(0, 7);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <PageHeader title="เวลาทำงานของฉัน" subtitle="อ่านอย่างเดียว · ตอกบัตรที่เครื่องประจำสาขา" icon={<Clock className="size-5" aria-hidden="true" />} />

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="icon" aria-label="เดือนก่อน" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <span className="text-sm font-semibold">{thaiMonthLabel(month)}</span>
        <Button variant="outline" size="icon" aria-label="เดือนถัดไป" disabled={isCurrentMonth} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <QueryBoundary isLoading={me.isLoading} isError={me.isError} error={me.error} onRetry={me.refetch} errorTitle="โหลดเวลาทำงานไม่สำเร็จ">
        {me.data && (
          <>
            <ul role="list" aria-label="สรุปเดือน" className="grid grid-cols-4 gap-2">
              {[
                { label: 'มา', value: String(me.data.summary.workDays) },
                { label: 'สาย', value: String(me.data.summary.lateCount) },
                { label: 'ลา/หยุด', value: `${me.data.summary.leave}/${me.data.rows.filter((r) => r.dayKind === 'DAY_OFF').length}` },
                { label: 'OT ชม.', value: fmtOt(me.data.summary.otHours) },
              ].map((k) => (
                <li key={k.label} className="flex flex-col gap-0.5 rounded-xl border border-border bg-card px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">{k.label}</span>
                  <b className="text-xl font-bold leading-tight tabular-nums">{k.value}</b>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground leading-snug">
              OT นับเมื่อออกหลังเวลาเลิกงานตั้งแต่ 15 นาทีขึ้นไป ปัดเป็นชั่วโมงตามกติกาเศษนาที (15–44 นาที = 0.5 ชม. · 45–59 นาที = 1 ชม.)
            </p>

            {me.data.rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลลงเวลาในเดือนนี้</p>
            ) : (
              <ul role="list" aria-label="รายวัน" className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {me.data.rows.map((row) => (
                  <li key={row.date} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{thaiShortDate(row.date)}</div>
                      <div className="text-xs text-muted-foreground leading-snug">
                        {rowDetail(row, today)}
                        {row.correctedCount > 0 && <> · แก้โดย ผจก.{row.correctedCount > 1 ? ` ${row.correctedCount} ครั้ง` : ''}</>}
                      </div>
                    </div>
                    <StatusChip status={row.status} lateMinutes={row.lateMinutes} otHours={row.otHours} className="shrink-0" />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground leading-snug">
              เห็นข้อมูลไม่ตรง แจ้งผู้จัดการสาขาหรือเจ้าของให้แก้ (แก้เองไม่ได้ · ทุกการแก้มีประวัติ)
            </p>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

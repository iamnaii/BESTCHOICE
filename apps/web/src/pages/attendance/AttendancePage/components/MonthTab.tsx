import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import QueryBoundary from '@/components/QueryBoundary';
import { useAttendanceMonth, type MonthCell } from '@/hooks/useAttendance';
import { PaidBanner, PaidChip, distinctNumbers } from './PaidLock';
import { exportToExcel } from '@/utils/excel.util';
import { EXCEL_COLUMNS, FLAG_LABEL, REVIEW_FLAGS, flagChipClass, fmtOt, shiftMonth, statusView, summaryToExcelRow, thaiMonthLabel, thaiShortDate } from '../../attendance.util';

interface Props {
  branchId: string;
  branchName: string;
  month: string;
  onMonthChange: (next: string) => void;
  /** เปิดวันนั้นในแท็บ "วันนี้" (ดูรูป/แก้ไข/ล้างธง) */
  onOpenDay: (date: string) => void;
}

/** สัญลักษณ์ = ไอคอนชุดเดียวกับช่องในตาราง */
const LEGEND = (['ON_TIME', 'LATE', 'ABSENT', 'LEAVE', 'DAY_OFF', 'UNAVAILABLE'] as const).map((st) => ({ status: st, view: statusView(st, st === 'LATE' ? 1 : 0, 0) }));

const THAI_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const dow = (date: string) => { const [y, m, d] = date.split('-').map(Number); return THAI_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };

function CellBox({ date, cell }: { date: string; cell: MonthCell | undefined }) {
  if (!cell || cell.status === 'NONE') return <span className="inline-flex size-7 items-center justify-center rounded-md text-xs text-muted-foreground/60" title={`${thaiShortDate(date)} · ไม่มีข้อมูล`}>·</span>;
  const view = statusView(cell.status, cell.lateMinutes, cell.otHours);
  const Icon = view.icon;
  const short = cell.status === 'LATE' ? String(cell.lateMinutes) : cell.status === 'ON_TIME' && cell.otHours > 0 ? fmtOt(cell.otHours) : null;
  const corrected = cell.flags.includes('CORRECTED');
  return (
    <span
      title={`${thaiShortDate(date)} · ${view.label}${cell.flags.length ? ` · ${cell.flags.join(', ')}` : ''}`}
      className={`inline-flex size-7 items-center justify-center rounded-md border text-[11px] font-semibold ${view.className} ${corrected ? 'border-dashed' : ''} ${cell.status === 'ON_TIME' && cell.otHours > 0 ? 'bg-foreground text-background border-foreground' : ''}`}
    >
      {short ?? <Icon className="size-3.5" aria-hidden="true" />}
      <span className="sr-only">{view.label}</span>
    </span>
  );
}

export default function MonthTab({ branchId, branchName, month, onMonthChange, onOpenDay }: Props) {
  const q = useAttendanceMonth(branchId, month);
  const data = q.data;
  const review = (data?.rows ?? []).flatMap((r) =>
    Object.entries(r.cells)
      .map(([date, c]) => ({ date, nickname: r.nickname, name: r.name, flags: c.flags.filter((f) => REVIEW_FLAGS.includes(f)) }))
      .filter((x) => x.flags.length > 0),
  ).sort((a, b) => a.date.localeCompare(b.date) || a.nickname.localeCompare(b.nickname, 'th'));

  const exportExcel = async () => {
    if (!data) return;
    try {
      await exportToExcel({ data: data.rows.map((r) => summaryToExcelRow(r.name, r.summary)), columns: EXCEL_COLUMNS, sheetName: 'ลงเวลา', filename: `attendance-${branchName}-${month}.xlsx` });
    } catch (err) {
      toast.error((err as Error)?.message ?? 'ส่งออกไม่สำเร็จ');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label="เดือนก่อนหน้า" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <div className="text-base font-semibold">{thaiMonthLabel(month)}</div>
          <Button variant="outline" size="sm" aria-label="เดือนถัดไป" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight className="size-4" aria-hidden="true" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <ul role="list" aria-label="สัญลักษณ์" className="flex flex-wrap items-center gap-2">
            {LEGEND.map(({ status, view }) => {
              const Icon = view.icon;
              return (
                <li key={status} className="inline-flex items-center gap-1">
                  <span className={`inline-flex size-5 items-center justify-center rounded border ${view.className}`}><Icon className="size-3" aria-hidden="true" /></span>
                  {status === 'LATE' ? 'สาย (ตัวเลข = นาที)' : view.label}
                </li>
              );
            })}
            <li className="inline-flex items-center gap-1"><span className="inline-flex size-5 items-center justify-center rounded border border-foreground bg-foreground text-[10px] font-semibold text-background">1.5</span>OT (ชม.)</li>
            <li className="inline-flex items-center gap-1"><span className="inline-flex size-5 rounded border border-dashed border-border" aria-hidden="true" />แก้ไขย้อนหลัง</li>
          </ul>
          <Button variant="outline" size="sm" onClick={() => void exportExcel()} disabled={!data}><Download className="size-4" aria-hidden="true" />ส่งออก Excel</Button>
        </div>
      </div>

      <QueryBoundary isLoading={q.isLoading && !data} isError={q.isError} error={q.error} onRetry={q.refetch} errorTitle="โหลดข้อมูลรายเดือนไม่สำเร็จ">
        {data && <PaidBanner month={month} numbers={distinctNumbers(data.rows)} people={data.rows.filter((r) => r.paidDocumentNumber).length} />}
        {data && (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="ตารางรายเดือน">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">พนักงาน</th>
                    {data.days.map((d) => <th key={d} className="px-1 py-2 text-center font-medium whitespace-nowrap">{dow(d)} {Number(d.slice(-2))}</th>)}
                    <th className="border-l border-border px-2 py-2 text-right font-medium">วันทำงาน</th>
                    <th className="px-2 py-2 text-right font-medium">สาย</th>
                    <th className="px-2 py-2 text-right font-medium">ขาด</th>
                    <th className="px-2 py-2 text-right font-medium">ลา</th>
                    <th className="px-2 py-2 text-right font-medium">OT ชม.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.userId} className="border-t border-border">
                      <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                        <div className="font-semibold leading-snug">{r.nickname}</div>
                        <div className="text-xs text-muted-foreground leading-snug">{r.name}</div>
                        {r.paidDocumentNumber && <div className="mt-1"><PaidChip number={r.paidDocumentNumber} /></div>}
                      </td>
                      {data.days.map((d) => <td key={d} className="px-0.5 py-1.5 text-center"><CellBox date={d} cell={r.cells[d]} /></td>)}
                      <td className="border-l border-border px-2 py-1.5 text-right tabular-nums">{r.summary.workDays}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${r.summary.lateCount ? 'font-semibold text-warning-strong' : ''}`}>{r.summary.lateCount ? `${r.summary.lateCount} · ${r.summary.lateMinutes} นาที` : 0}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${r.summary.absent ? 'font-semibold text-destructive' : ''}`}>{r.summary.absent}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.summary.leave}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtOt(r.summary.otHours)}</td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && <tr><td colSpan={data.days.length + 6} className="px-3 py-8 text-center text-sm text-muted-foreground">ยังไม่มีพนักงานในสาขานี้</td></tr>}
                </tbody>
              </table>
            </div>
            {review.length > 0 && (
              <section className="border-t border-border px-4 py-3">
                <h3 className="mb-2 text-sm font-semibold">วันที่ต้องตรวจ ({review.length})</h3>
                <ul role="list" aria-label="วันที่ต้องตรวจ" className="flex flex-col divide-y divide-border">
                  {review.map((x) => (
                    <li key={`${x.date}-${x.nickname}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{thaiShortDate(x.date)}</span>
                        <span>{x.nickname}</span>
                        {x.flags.map((f) => {
                          const v = FLAG_LABEL[f];
                          if (!v) return null;
                          const Icon = v.icon;
                          return <span key={f} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${flagChipClass(f)}`}><Icon className="size-3" aria-hidden="true" />{v.label}</span>;
                        })}
                      </div>
                      <Button variant="outline" size="sm" className="max-lg:min-h-11" onClick={() => onOpenDay(x.date)} aria-label={`เปิดวันนั้น — ${x.nickname} ${thaiShortDate(x.date)}`}>เปิดวันนั้น</Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span>วางเมาส์บนช่องวันเพื่อดูรายละเอียด · แก้ไขรายวันได้จากแท็บ "วันนี้" (เลือกวันที่)</span>
              <span>ชั่วโมง OT × 1.5 × (เงินเดือน ÷ 30 ÷ 8) คิดที่หน้าเงินเดือน (ก้อน D4)</span>
            </div>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

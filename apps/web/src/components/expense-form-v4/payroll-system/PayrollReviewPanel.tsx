import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Clock, ExternalLink, KeyRound, Lock, type LucideIcon } from 'lucide-react';
import { FLAG_LABEL, flagChipClass, fmtOt, statusView, thaiShortDate } from '@/pages/attendance/attendance.util';
import type { PayrollSystemNotes, PayrollSystemWarning } from '../types';
import { submitCutoffText } from './payroll-copy';

/**
 * Payroll D4 ส่วนที่ 1 (mockup กระดาน 1 แผงขวา) — วันที่ต้องตรวจ + คำเตือน จาก `systemNotes` ที่ server เก็บไว้ต่อบรรทัด
 * (ผู้อนุมัติเห็นชุดเดียวกัน) · เครื่องถูกใช้ซ้อนขึ้นก่อนเสมอ (อนุมัติไม่ได้จนกว่าเจ้าของล้างธง)
 */

export const REVIEW_LINK_LABEL = 'เปิดวันนั้นที่ ลงเวลา';
export const REVIEW_NO_LINK_TEXT = 'ให้เจ้าของหรือผู้จัดการสาขาตรวจที่เมนู ลงเวลา';

interface ReviewLine {
  employeeName: string;
  systemNotes: PayrollSystemNotes | null;
}

export interface Viewer {
  role: string;
  branchId: string | null;
}

/** หน้าลงเวลาเปิดได้เฉพาะเจ้าของ (ทุกสาขา) และผู้จัดการสาขาของสาขาวันนั้น */
const canOpenDay = (viewer: Viewer | null | undefined, day: { branchId: string }) =>
  viewer?.role === 'OWNER' ||
  (viewer?.role === 'BRANCH_MANAGER' && !!viewer.branchId && viewer.branchId === day.branchId);

/**
 * ลิงก์ "เปิดวันนั้นที่ ลงเวลา" (แท็บใหม่ · พาวันที่และสาขาของวันนั้นไป — คำตัดสิน R13) สำหรับคนที่เปิดหน้าลงเวลาได้ ·
 * คนอื่นเห็นข้อความบอกว่าใครตรวจได้ · ใช้ทั้งแผงตรวจและแบนเนอร์วันติดธงของหน้ารายละเอียด
 */
export function AttendanceDayLink({
  day,
  viewer,
}: {
  day: { date: string; branchId: string };
  viewer: Viewer | null | undefined;
}) {
  if (!canOpenDay(viewer, day)) {
    return <p className="text-xs text-muted-foreground leading-snug">{REVIEW_NO_LINK_TEXT}</p>;
  }
  return (
    <Link
      // Task 9 อ่าน ?tab ?date ?branchId
      to={`/attendance?tab=today&date=${day.date}&branchId=${day.branchId}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-9 w-max items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium leading-snug hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {REVIEW_LINK_LABEL}
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">(เปิดแท็บใหม่)</span>
    </Link>
  );
}

function flagView(flag: string): { label: string; icon: LucideIcon } {
  if (FLAG_LABEL[flag]) return FLAG_LABEL[flag];
  if (flag === 'MISSING_OUT') {
    const v = statusView('MISSING_OUT');
    return { label: v.label, icon: v.icon };
  }
  return { label: flag, icon: AlertTriangle };
}

interface WarningItem {
  key: string;
  icon: LucideIcon;
  iconClass: string;
  body: ReactNode;
}

function lineWarning(name: string, w: Exclude<PayrollSystemWarning, { code: 'NOT_YET_CLOSABLE' }>, key: string): WarningItem {
  switch (w.code) {
    case 'NOT_MONTHLY_OR_NO_BASE':
      return {
        key,
        icon: AlertTriangle,
        iconClass: 'text-warning-strong',
        body: (
          <>
            <b className="font-semibold">{name}</b>{' '}
            <span>{`พนักงานรายวัน/สัญญาจ้าง หรือไม่มีเงินเดือนในทะเบียน — ระบบไม่คิด OT ให้ ลงเวลาเดือนนี้มี OT ${fmtOt(parseFloat(w.otHours))} ชม. กรอกในรายได้พิเศษเอง`}</span>
          </>
        ),
      };
    case 'IN_OTHER_DOCUMENT':
      return {
        key,
        icon: Lock,
        iconClass: 'text-muted-foreground',
        body: <span>{`OT ของ ${name} เดือนนี้อยู่ในใบ ${w.documentNumber} แล้ว — เอาออกจากใบใดใบหนึ่งก่อน`}</span>,
      };
    case 'NO_PIN':
      return {
        key,
        icon: KeyRound,
        iconClass: 'text-muted-foreground',
        body: (
          <>
            <b className="font-semibold">{name}</b> <span>ยังไม่มีรหัสตอกบัตร — เดือนนี้ไม่มีข้อมูลลงเวลา ระบบจึงไม่คิด OT ให้</span>
          </>
        ),
      };
  }
}

export function PayrollReviewPanel({
  lines,
  viewer,
  label = 'ตรวจก่อนบันทึก',
}: {
  lines: ReviewLine[];
  viewer: Viewer | null | undefined;
  /** ชื่อของแผง (aria-label) — ฟอร์ม = ตรวจก่อนบันทึก · หน้ารายละเอียด = ตรวจก่อนอนุมัติ */
  label?: string;
}) {
  const reviewId = useId();
  const warningId = useId();

  const days = lines
    .flatMap((l) => (l.systemNotes?.review ?? []).map((day) => ({ day, name: l.employeeName })))
    .sort(
      (a, b) =>
        Number(b.day.blocking) - Number(a.day.blocking) ||
        a.day.date.localeCompare(b.day.date) ||
        a.name.localeCompare(b.name, 'th'),
    );

  // เวลาปิดงวดเป็นของทั้งใบ (ทุกบรรทัดได้ค่าเดียวกัน) — แสดงครั้งเดียว
  const cutoffs = [
    ...new Set(
      lines.flatMap((l) =>
        (l.systemNotes?.warnings ?? []).flatMap((w) => (w.code === 'NOT_YET_CLOSABLE' ? [w.closableAt] : [])),
      ),
    ),
  ];
  const warnings: WarningItem[] = [
    ...cutoffs.map((at) => ({
      key: `cutoff-${at}`,
      icon: Clock,
      iconClass: 'text-info',
      body: <span>{submitCutoffText(at)}</span>,
    })),
    ...lines.flatMap((l, li) =>
      (l.systemNotes?.warnings ?? []).flatMap((w, wi) =>
        w.code === 'NOT_YET_CLOSABLE' ? [] : [lineWarning(l.employeeName, w, `${li}-${wi}`)],
      ),
    ),
  ];

  if (days.length === 0 && warnings.length === 0) return null;

  return (
    <aside aria-label={label} className="flex min-w-0 flex-col gap-3">
      {days.length > 0 && (
        <section aria-labelledby={reviewId} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <h3 id={reviewId} className="flex items-center gap-1.5 text-sm font-semibold leading-snug">
            <AlertTriangle className="size-4 shrink-0 text-warning-strong" aria-hidden="true" />
            {`วันที่ต้องตรวจ (${days.length})`}
          </h3>
          <ul className="flex flex-col gap-2">
            {days.map(({ day, name }) => (
              <li key={`${day.dayId}-${name}`} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium leading-snug">{name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground leading-snug">{thaiShortDate(day.date)}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {day.flags.map((flag) => {
                    const v = flagView(flag);
                    const Icon = v.icon;
                    return (
                      <span
                        key={flag}
                        data-flag={flag}
                        className={`inline-flex w-max items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-snug ${flagChipClass(flag)}`}
                      >
                        <Icon className="size-3 shrink-0" aria-hidden="true" />
                        {v.label}
                      </span>
                    );
                  })}
                </div>
                <AttendanceDayLink day={day} viewer={viewer} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section aria-labelledby={warningId} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <h3 id={warningId} className="text-sm font-semibold leading-snug">{`คำเตือน (${warnings.length})`}</h3>
          <ul className="flex flex-col gap-2">
            {warnings.map((w) => {
              const Icon = w.icon;
              return (
                <li key={w.key} className="flex items-start gap-2 text-xs leading-snug">
                  <Icon className={`mt-0.5 size-3.5 shrink-0 ${w.iconClass}`} aria-hidden="true" />
                  <p className="min-w-0">{w.body}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}

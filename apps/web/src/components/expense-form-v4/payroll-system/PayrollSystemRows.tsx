import { useId } from 'react';
import { Clock, Lock } from 'lucide-react';
import ScreenTable from '@/components/ui/ScreenTable';
import { formatNumberDecimal } from '@/utils/formatters';
import { THAI_MONTHS_SHORT } from '@/lib/date';
import { fmtOt } from '@/pages/attendance/attendance.util';
import type { PayrollAttendanceSummary, PayrollSystemIncomeRow } from '../types';

/**
 * Payroll D4 ส่วนที่ 1 (mockup กระดาน 1) — ของที่ server เก็บไว้ต่อบรรทัด แสดงอ่านอย่างเดียว:
 * ตารางรายได้จากระบบ (ล็อก ไม่มีช่องกรอก) + กล่องสรุปลงเวลา (ข้อมูลประกอบ ไม่หักเงิน)
 */

export const SYSTEM_ROWS_TITLE = 'รายได้จากระบบ — แก้ในใบนี้ไม่ได้';

const hours = (v: string) => fmtOt(parseFloat(v));

/** อัตราเก็บ 4 ตำแหน่ง (แสดงอย่างเดียว) — แสดงอย่างน้อย 2 ตำแหน่ง ไม่ตัดเศษที่มีจริง (103.125) */
function rateText(rate: string): string {
  const decimals = Math.min(4, Math.max(2, (rate.split('.')[1] ?? '').replace(/0+$/, '').length));
  return formatNumberDecimal(rate, decimals);
}

const hoursTimesRate = (r: PayrollSystemIncomeRow) =>
  r.quantity != null && r.rate != null ? `${hours(r.quantity)} × ${rateText(r.rate)}` : '—';

const sourceLabel = (source: string) => (source.startsWith('ATTENDANCE_') ? 'จากระบบลงเวลา' : 'จากระบบ');

export function PayrollSystemRows({
  rows,
  accountLabel,
}: {
  rows: PayrollSystemIncomeRow[];
  /** รหัส → "รหัส ชื่อบัญชี" (จาก payroll meta) */
  accountLabel: (code: string) => string;
}) {
  const titleId = useId();
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-primary/30 bg-card overflow-hidden">
      <div className="flex items-center gap-1.5 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary leading-snug">
        <Lock className="size-3.5 shrink-0" aria-hidden="true" />
        <span id={titleId}>{SYSTEM_ROWS_TITLE}</span>
      </div>
      <ScreenTable className="w-full text-xs">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1 w-40">บัญชี</th>
            <th className="text-left px-2 py-1">รายการ</th>
            <th className="text-right px-2 py-1 w-28">ชม. × อัตรา</th>
            <th className="text-right px-2 py-1 w-24">จำนวน</th>
            <th className="text-left px-2 py-1 w-32">ที่มา</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.source}-${i}`} className="border-t border-border">
              <td className="px-2 py-1.5 text-muted-foreground leading-snug">{accountLabel(r.accountCode)}</td>
              <td className="px-2 py-1.5 leading-snug">{r.name}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{hoursTimesRate(r)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatNumberDecimal(r.amount, 2)}</td>
              <td className="px-2 py-1.5">
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary leading-snug">
                  <Clock className="size-3 shrink-0" aria-hidden="true" />
                  {sourceLabel(r.source)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </ScreenTable>
    </section>
  );
}

/** `period` = งวดของใบ ('YYYY-MM') → "ต.ค. 2569" */
export function AttendanceSummaryBox({ summary, period }: { summary: PayrollAttendanceSummary; period: string }) {
  const titleId = useId();
  const [y, m] = period.split('-').map(Number);
  const month = THAI_MONTHS_SHORT[m - 1] ? `${THAI_MONTHS_SHORT[m - 1]} ${y + 543}` : period;
  const items: Array<[string, string]> = [
    ['มาทำงาน', `${summary.workDays} วัน`],
    ['มาวันหยุด', `${summary.holidayWorkedDays} วัน`],
    ['สาย', summary.lateCount > 0 ? `${summary.lateCount} ครั้ง · ${summary.lateMinutes} นาที` : '0 ครั้ง'],
    ['ขาด', `${summary.absent} วัน`],
    ['ลา', `${summary.leave} วัน`],
    ['OT วันทำงาน', `${hours(summary.otHours)} ชม.`],
    ['ทำงานวันหยุด', `${hours(summary.holidayHours)} ชม.`],
    ['OT วันหยุด', `${hours(summary.holidayOtHours)} ชม.`],
  ];
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border bg-muted/40">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium leading-snug">
        <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span id={titleId}>{`สรุปลงเวลา ${month} — ข้อมูลประกอบ ไม่หักเงิน`}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 px-3 pb-2.5 sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col">
            <dt className="text-xs text-muted-foreground leading-snug">{label}</dt>
            <dd className="text-sm tabular-nums leading-snug">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

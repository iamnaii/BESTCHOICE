import { Fragment, useId, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Coins, Lock, Undo2 } from 'lucide-react';
import ScreenTable from '@/components/ui/ScreenTable';
import { formatNumberDecimal } from '@/utils/formatters';
import { THAI_MONTHS_SHORT } from '@/lib/date';
import { fmtOt } from '@/pages/attendance/attendance.util';
import type {
  PayrollAttendanceSummary,
  PayrollCommissionItemView,
  PayrollSystemDeductionRow,
  PayrollSystemIncomeRow,
} from '../types';
import {
  CLAWBACK_CAP_NOTE,
  EARLIER_PERIOD_LABEL,
  SYSTEM_DEDUCTIONS_TITLE,
  baht2,
  carryForwardText,
  commissionCountLabel,
  thaiDayMonth,
} from './payroll-copy';

/**
 * Payroll D4 ส่วนที่ 1 (mockup กระดาน 1) — ของที่ server เก็บไว้ต่อบรรทัด แสดงอ่านอย่างเดียว:
 * ตารางรายได้จากระบบ (ล็อก ไม่มีช่องกรอก) + กล่องสรุปลงเวลา (ข้อมูลประกอบ ไม่หักเงิน)
 * ส่วนที่ 2 (กระดาน 1 + 6B) — แถวค่าคอม (ไม่มีชั่วโมง/อัตรา) พร้อมรายการค่าคอมแบบกดเปิด · ตารางรายการหักจากระบบ (หักคืนค่าคอม)
 * พร้อมยอดที่ยกไปงวดหน้า — ไม่อ่าน autoOtEligible / attendanceTracked / NO_PIN (ค่าคอมไม่ขึ้นกับลงเวลา)
 */

export const SYSTEM_ROWS_TITLE = 'รายได้จากระบบ — แก้ในใบนี้ไม่ได้';

const hours = (v: string) => fmtOt(parseFloat(v));

/** อัตราเก็บ 4 ตำแหน่ง (แสดงอย่างเดียว) — แสดงอย่างน้อย 2 ตำแหน่ง ไม่ตัดเศษที่มีจริง (103.125) */
export function rateText(rate: string): string {
  const decimals = Math.min(4, Math.max(2, (rate.split('.')[1] ?? '').replace(/0+$/, '').length));
  return formatNumberDecimal(rate, decimals);
}

const hoursTimesRate = (r: PayrollSystemIncomeRow) =>
  r.quantity != null && r.rate != null ? `${hours(r.quantity)} × ${rateText(r.rate)}` : '—';

/** แถวที่คิดจากการลงเวลา (OT / ทำงานวันหยุด / OT วันหยุด) — ส่วนที่ 2 จะมีแถวระบบแหล่งอื่น (ค่าคอม) ด้วย */
export const isAttendanceSource = (source: string) => source.startsWith('ATTENDANCE_');

const sourceLabel = (source: string) => (isAttendanceSource(source) ? 'จากระบบลงเวลา' : 'จากระบบ');

const SOURCE_CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary leading-snug';

/** วันที่ของค่าคอม + "อนุมัติค้างจากงวดก่อน" เมื่อค่าคอมเป็นของงวดก่อนหน้างวดของใบ */
const commissionItemNote = (i: PayrollCommissionItemView, period: string) =>
  [thaiDayMonth(i.date), i.kind === 'PAY' && period && i.period < period ? EARLIER_PERIOD_LABEL : null]
    .filter(Boolean)
    .join(' · ');

/** แถวค่าคอม + รายการที่จ่าย (กดเปิด/ปิด — ปุ่มบอกสถานะด้วย aria-expanded และลูกศร) */
function CommissionRowGroup({
  row,
  items,
  period,
  accountLabel,
}: {
  row: PayrollSystemIncomeRow;
  items: PayrollCommissionItemView[];
  period: string;
  accountLabel: (code: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const pay = items.filter((i) => i.kind === 'PAY');
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="border-t border-border">
        <td className="px-2 py-1.5 text-muted-foreground leading-snug">{accountLabel(row.accountCode)}</td>
        <td className="px-2 py-1.5 leading-snug">{row.name}</td>
        <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{hoursTimesRate(row)}</td>
        <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatNumberDecimal(row.amount, 2)}</td>
        <td className="px-2 py-1.5">
          {pay.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((v) => !v)}
              // ≥ 36 px ให้กดได้ (P2-R30)
              className={`${SOURCE_CHIP} min-h-9 hover:bg-primary/20 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <Coins className="size-3 shrink-0" aria-hidden="true" />
              {commissionCountLabel(pay.length)}
              <Chevron className="size-3 shrink-0" aria-hidden="true" />
            </button>
          ) : (
            <span className={SOURCE_CHIP}>
              <Coins className="size-3 shrink-0" aria-hidden="true" />
              {sourceLabel(row.source)}
            </span>
          )}
        </td>
      </tr>
      {pay.length > 0 && (
        <tr id={listId} hidden={!open} className="bg-muted/20">
          <td colSpan={5} className="px-2 py-1.5">
            <ul className="flex flex-col gap-1">
              {pay.map((i, n) => (
                <li key={`${i.reference}-${n}`} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_6rem] items-baseline gap-2 pl-4 text-xs leading-snug">
                  {/* ไม่ตัดด้วย … — เลขอ้างอิงต้องอ่านครบ (ui-ux-pro-max "Truncation") */}
                  <span className="break-all font-mono">{i.reference}</span>
                  <span className="text-muted-foreground">{commissionItemNote(i, period)}</span>
                  <span className="text-right font-mono tabular-nums">{baht2(i.amount)}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

export function PayrollSystemRows({
  rows,
  accountLabel,
  commissionItems = [],
  period = '',
}: {
  rows: PayrollSystemIncomeRow[];
  /** รหัส → "รหัส ชื่อบัญชี" (จาก payroll meta) */
  accountLabel: (code: string) => string;
  /** ส่วนที่ 2 — รายการค่าคอมของบรรทัด (แถว COMMISSION แสดงรายการ PAY) */
  commissionItems?: PayrollCommissionItemView[];
  /** งวดของใบ 'YYYY-MM' — ป้าย "อนุมัติค้างจากงวดก่อน" */
  period?: string;
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
          {rows.map((r, i) =>
            r.source === 'COMMISSION' ? (
              <CommissionRowGroup
                key={`${r.source}-${i}`}
                row={r}
                items={commissionItems}
                period={period}
                accountLabel={accountLabel}
              />
            ) : (
              <tr key={`${r.source}-${i}`} className="border-t border-border">
                <td className="px-2 py-1.5 text-muted-foreground leading-snug">{accountLabel(r.accountCode)}</td>
                <td className="px-2 py-1.5 leading-snug">{r.name}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{hoursTimesRate(r)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatNumberDecimal(r.amount, 2)}</td>
                <td className="px-2 py-1.5">
                  <span className={SOURCE_CHIP}>
                    <Clock className="size-3 shrink-0" aria-hidden="true" />
                    {sourceLabel(r.source)}
                  </span>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </ScreenTable>
    </section>
  );
}

/**
 * กระดาน 6B — รายการหักจากระบบ (หักคืนค่าคอม) ล็อก ไม่มีช่องกรอก · ใต้แต่ละแถวคือค่าคอมที่หักคืน (อ้างอิง · เหตุผล · วันที่)
 * · ท้ายตาราง "ยกไปงวดหน้า {y} บาท" จากคำเตือน CLAWBACK_CARRIED ของบรรทัด (หักได้ไม่เกินค่าคอมงวดนี้)
 * · ไม่มีแถวหักแต่ยกไป (งวดนี้ไม่มีค่าคอม) = ยังแสดงตาราง พร้อมยอดที่ยกไป
 */
export function PayrollSystemDeductions({
  rows,
  commissionItems = [],
  carried,
  accountLabel,
}: {
  rows: PayrollSystemDeductionRow[];
  commissionItems?: PayrollCommissionItemView[];
  /** ยอดที่ยกไปงวดหน้า (2 ตำแหน่ง) — ไม่มี = หักครบ */
  carried?: string | null;
  accountLabel: (code: string) => string;
}) {
  const titleId = useId();
  if (rows.length === 0 && !carried) return null;
  const clawbacks = commissionItems.filter((i) => i.kind === 'CLAWBACK');
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-warning/40 bg-card overflow-hidden">
      <div className="flex items-center gap-1.5 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning-strong leading-snug">
        <Lock className="size-3.5 shrink-0" aria-hidden="true" />
        <span aria-hidden="true">−</span>
        <span id={titleId}>{SYSTEM_DEDUCTIONS_TITLE}</span>
      </div>
      <ScreenTable className="w-full text-xs">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1 w-40 leading-snug">บัญชี</th>
            <th className="text-left px-2 py-1 leading-snug">รายการ</th>
            <th className="text-right px-2 py-1 w-28 leading-snug">หักงวดนี้</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-2 py-2 text-center text-muted-foreground italic leading-snug">
                งวดนี้ไม่มีรายการหัก
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <Fragment key={`${r.source}-${r.accountCode}-${i}`}>
              <tr className="border-t border-border">
                <td className="px-2 py-1.5 text-muted-foreground leading-snug">{accountLabel(r.accountCode)}</td>
                <td className="px-2 py-1.5 leading-snug">
                  <span className="inline-flex items-center gap-1">
                    <Undo2 className="size-3 shrink-0 text-warning-strong" aria-hidden="true" />
                    {r.name}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{baht2(r.amount)}</td>
              </tr>
              {clawbacks
                .filter((c) => c.accountCode === r.accountCode)
                .map((c, n) => (
                  <tr key={`${c.reference}-${n}`} className="bg-muted/20">
                    <td></td>
                    <td className="px-2 py-1 pl-6 leading-snug">
                      <span className="font-mono">{c.reference}</span>
                      <span className="text-muted-foreground">
                        {[c.reason, thaiDayMonth(c.date)].filter(Boolean).map((t) => ` · ${t}`).join('')}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">{baht2(c.amount)}</td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
        {carried && (
          <tfoot className="border-t border-border bg-warning/5">
            <tr>
              <td colSpan={3} className="px-2 py-1.5 leading-snug">
                <span className="font-medium text-warning-strong">{carryForwardText(carried)}</span>
                <span className="text-muted-foreground">{` — ${CLAWBACK_CAP_NOTE}`}</span>
              </td>
            </tr>
          </tfoot>
        )}
      </ScreenTable>
    </section>
  );
}

/** งวด 'YYYY-MM' → "ต.ค. 2569" */
export const payrollPeriodShort = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return THAI_MONTHS_SHORT[m - 1] ? `${THAI_MONTHS_SHORT[m - 1]} ${y + 543}` : period;
};

/** รายการของสรุปลงเวลา [หัวข้อ, ค่า] — ใช้ทั้งกล่องในฟอร์มและกล่องบนสลิปเงินเดือน */
export function attendanceSummaryItems(summary: PayrollAttendanceSummary): Array<[string, string]> {
  return [
    ['มาทำงาน', `${summary.workDays} วัน`],
    ['มาวันหยุด', `${summary.holidayWorkedDays} วัน`],
    ['สาย', summary.lateCount > 0 ? `${summary.lateCount} ครั้ง · ${summary.lateMinutes} นาที` : '0 ครั้ง'],
    ['ขาด', `${summary.absent} วัน`],
    ['ลา', `${summary.leave} วัน`],
    ['OT วันทำงาน', `${hours(summary.otHours)} ชม.`],
    ['ทำงานวันหยุด', `${hours(summary.holidayHours)} ชม.`],
    ['OT วันหยุด', `${hours(summary.holidayOtHours)} ชม.`],
  ];
}

/** `period` = งวดของใบ ('YYYY-MM') → "ต.ค. 2569" */
export function AttendanceSummaryBox({ summary, period }: { summary: PayrollAttendanceSummary; period: string }) {
  const titleId = useId();
  const month = payrollPeriodShort(period);
  const items = attendanceSummaryItems(summary);
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

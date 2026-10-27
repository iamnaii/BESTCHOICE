import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';
import Decimal from 'decimal.js';
import { AlertTriangle, Clock, Pencil, Printer } from 'lucide-react';
import ScreenTable from '@/components/ui/ScreenTable';
import { Button } from '@/components/ui/button';
import { formatNumberDecimal } from '@/utils/formatters';
import { fmtOt } from '@/pages/attendance/attendance.util';
import { PayrollReviewPanel } from '@/components/expense-form-v4/payroll-system/PayrollReviewPanel';
import { isAttendanceSource } from '@/components/expense-form-v4/payroll-system/PayrollSystemRows';
import type { StoredPayrollLine } from '@/components/expense-form-v4/payroll-system/payroll-lines';
import {
  NOT_YET_CLOSABLE_REASON,
  SLIP_NEEDS_POST,
  SLIP_PAPER_ONLY,
  deviceConflictReason,
  deviceConflictText,
  postCutoffText,
  slipButtonLabel,
  submitCutoffText,
} from '@/components/expense-form-v4/payroll-system/payroll-copy';
import {
  isPayrollEditable,
  payrollEditPath,
  type PayrollConflict,
} from '@/components/expense-form-v4/payroll-system/payroll-status';
import type { PayrollGateView, PayrollStaleDiff } from '@/components/expense-form-v4/types';

/**
 * Payroll D4 ส่วนที่ 1 (mockup กระดาน 2 + 6A) — ส่วนเฉพาะใบเงินเดือนของหน้ารายละเอียด:
 * ด่านจาก `payrollGate` (เวลาปิดงวด · วันติดธงเครื่องถูกใช้ซ้อน) · 409 PAYROLL_STALE พร้อมตาราง diff ·
 * ตารางบรรทัด (ยอดที่เก็บไว้ ไม่คิดใหม่) · วันที่ต้องตรวจ/คำเตือนที่เก็บต่อบรรทัด · ปุ่ม แก้ไข + พิมพ์สลิป
 */

export interface PayrollDetailLine extends StoredPayrollLine {
  id: string;
  netPaid: string;
}

export interface PayrollDetailDoc {
  id: string;
  documentType: string;
  status: string;
  payroll?: { payrollPeriod: string; lines: PayrollDetailLine[] } | null;
  /** null = ใบลงบัญชี/กลับรายการแล้ว หรือไม่มีด่าน (server ส่งเฉพาะ DRAFT / PENDING_APPROVAL / APPROVED) */
  payrollGate?: PayrollGateView | null;
}

/** ปุ่มหลักของใบที่ยังไม่อนุมัติ — ส่งขออนุมัติ (เปิดระบบอนุมัติ) หรือ ลงบัญชีตรง (ใบ APPROVED ก็ลงบัญชีตรง) */
export type PayrollPrimaryStep = 'submit' | 'post';

/**
 * เหตุผลที่ปุ่มจะโดน server ปฏิเสธตอนนี้ — ตามลำดับที่ server ตรวจ (เวลาปิดงวดก่อน แล้ววันติดธง) ·
 * ส่งขออนุมัติตรวจแค่เวลาปิดงวด · อนุมัติ/ลงบัญชีตรวจทั้งสอง · เวลาปิดงวดเชื่อค่าที่ server คิด (ไม่ใช้นาฬิกาเครื่อง)
 */
export function payrollBlockedReasons(
  gate: PayrollGateView | null | undefined,
  primary: PayrollPrimaryStep,
): { primary?: string; approve?: string } {
  if (!gate) return {};
  const cutoff = gate.closableAt ? NOT_YET_CLOSABLE_REASON : undefined;
  const flagged = gate.deviceConflicts.length > 0 ? deviceConflictReason(gate.deviceConflicts.length) : undefined;
  return { primary: primary === 'submit' ? cutoff : (cutoff ?? flagged), approve: cutoff ?? flagged };
}

const money = (v: Decimal) => formatNumberDecimal(v.toFixed(2), 2);
const dec = (v: string | null | undefined) => new Decimal(v || '0');

interface LineTotals {
  base: Decimal;
  attendance: Decimal;
  other: Decimal;
  sso: Decimal;
  net: Decimal;
}

/** แยกรายได้ของบรรทัดเป็น OT/วันหยุด (จากระบบลงเวลา) กับรายได้อื่น — ยอดของแต่ละแถวคือยอดที่เก็บไว้ */
function lineTotals(l: PayrollDetailLine): LineTotals {
  const rows = l.customIncome ?? [];
  const sum = (pick: (source: string) => boolean) =>
    rows.filter((r) => pick(r.source ?? 'MANUAL')).reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0));
  return {
    base: dec(l.baseSalary),
    attendance: sum(isAttendanceSource),
    other: sum((source) => !isAttendanceSource(source)),
    sso: dec(l.ssoEmployee),
    net: dec(l.netPaid),
  };
}

const COLUMNS: Array<[keyof LineTotals, string]> = [
  ['base', 'ฐาน'],
  ['attendance', 'OT / วันหยุด'],
  ['other', 'รายได้อื่น'],
  ['sso', 'SSO'],
  ['net', 'สุทธิ'],
];

function PayrollLinesTable({ lines }: { lines: PayrollDetailLine[] }) {
  const titleId = useId();
  const rows = lines.map((l) => ({ line: l, totals: lineTotals(l) }));
  const grand = COLUMNS.reduce(
    (acc, [key]) => ({ ...acc, [key]: rows.reduce((s, r) => s.plus(r.totals[key]), new Decimal(0)) }),
    {} as LineTotals,
  );
  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-lg border border-border bg-card overflow-hidden lg:flex-1">
      <h2 id={titleId} className="px-4 py-2 text-sm font-semibold leading-snug">
        {`รายการเงินเดือน (${lines.length} คน)`}
      </h2>
      <ScreenTable className="w-full text-sm" aria-label="รายการเงินเดือน">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-medium leading-snug">พนักงาน</th>
            {COLUMNS.map(([key, label]) => (
              <th key={key} className="px-4 py-2 text-right font-medium leading-snug whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ line, totals }) => (
            <tr key={line.id}>
              <td className="px-4 py-2 leading-snug">{line.employeeName}</td>
              {COLUMNS.map(([key]) => (
                <td
                  key={key}
                  className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${key === 'net' ? 'font-semibold' : ''}`}
                >
                  {money(totals[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-muted/30 font-semibold">
          <tr>
            <th scope="row" className="px-4 py-2 text-left leading-snug">
              รวม
            </th>
            {COLUMNS.map(([key]) => (
              <td key={key} className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                {money(grand[key])}
              </td>
            ))}
          </tr>
        </tfoot>
      </ScreenTable>
    </section>
  );
}

const diffText = (v: PayrollStaleDiff['stored']) =>
  v.hours != null ? `${fmtOt(parseFloat(v.hours))} ชม. · ${formatNumberDecimal(v.amount, 2)}` : formatNumberDecimal(v.amount, 2);

/** 409 PAYROLL_STALE — ข้อความของ server + ตาราง ในใบ/ตอนนี้ + ทางแก้ (แก้ไข → บันทึกใบใหม่ ระบบคิดยอดให้) */
function PayrollStaleAlert({ docId, conflict }: { docId: string; conflict: PayrollConflict }) {
  const ref = useRef<HTMLDivElement>(null);
  // ข้อความเกิดจากปุ่มที่แถบควบคุมด้านล่าง — ย้ายโฟกัสมาที่นี่ให้เห็นทันที
  useEffect(() => ref.current?.focus(), [conflict]);
  const diffs = conflict.diffs ?? [];
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <p className="text-sm font-medium leading-snug text-destructive">{conflict.message}</p>
      </div>
      {diffs.length > 0 && (
        <div className="rounded-md border border-border bg-card overflow-hidden">
          <ScreenTable className="w-full text-sm" aria-label="ยอดที่เปลี่ยน">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium leading-snug">พนักงาน</th>
                <th className="px-3 py-1.5 text-left font-medium leading-snug">รายการ</th>
                <th className="px-3 py-1.5 text-right font-medium leading-snug">ในใบ</th>
                <th className="px-3 py-1.5 text-right font-medium leading-snug">ตอนนี้</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {diffs.map((d, i) => (
                <tr key={`${d.userId}-${d.label}-${i}`}>
                  <td className="px-3 py-1.5 leading-snug">{d.employeeName}</td>
                  <td className="px-3 py-1.5 leading-snug">{d.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{diffText(d.stored)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-semibold">
                    {diffText(d.current)}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScreenTable>
        </div>
      )}
      <div>
        <Button asChild size="sm">
          <Link to={payrollEditPath(docId)}>
            <Pencil className="size-3.5" aria-hidden="true" />
            แก้ไข
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function PayrollDetailSection({
  doc,
  primary,
  staleConflict,
  viewer,
}: {
  doc: PayrollDetailDoc;
  primary: PayrollPrimaryStep;
  /** 409 PAYROLL_STALE ล่าสุดจากปุ่มอนุมัติ/ลงบัญชี (หน้าเก็บไว้จนกดสำเร็จ) */
  staleConflict: PayrollConflict | null;
  viewer: { role: string; branchId: string | null } | null | undefined;
}) {
  const gate = doc.payrollGate;
  const lines = doc.payroll?.lines ?? [];
  const cutoffText = gate?.closableAt
    ? doc.status === 'DRAFT' && primary === 'submit'
      ? submitCutoffText(gate.closableAt)
      : postCutoffText(gate.closableAt)
    : null;
  const conflicts = gate?.deviceConflicts ?? [];
  // เวลาปิดงวดที่เก็บในคำเตือนต่อบรรทัดเป็นของตอนบันทึก — หน้านี้ใช้ค่าสดจาก `payrollGate` (แบนเนอร์ด้านบน)
  const reviewLines = lines.map((l) => ({
    employeeName: l.employeeName,
    systemNotes: l.systemNotes
      ? { ...l.systemNotes, warnings: l.systemNotes.warnings.filter((w) => w.code !== 'NOT_YET_CLOSABLE') }
      : null,
  }));

  return (
    <div className="flex flex-col gap-4">
      {staleConflict && <PayrollStaleAlert docId={doc.id} conflict={staleConflict} />}
      {cutoffText && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 p-3">
          <Clock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-sm leading-snug text-foreground">{cutoffText}</p>
        </div>
      )}
      {conflicts.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm leading-snug text-foreground">{deviceConflictText(conflicts)}</p>
        </div>
      )}
      {lines.length > 0 && (
        // แผงตรวจไม่แสดงเมื่อไม่มีวันที่ต้องตรวจ/คำเตือน — ตารางจึงเต็มความกว้าง
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:[&>aside]:w-80 lg:[&>aside]:shrink-0">
          <PayrollLinesTable lines={lines} />
          <PayrollReviewPanel lines={reviewLines} viewer={viewer} label="ตรวจก่อนอนุมัติ" />
        </div>
      )}
    </div>
  );
}

/** ปุ่มเฉพาะใบเงินเดือนในแถบควบคุมภายใน: แก้ไข (ใบที่ยังไม่ลงบัญชี) + พิมพ์สลิป (เฉพาะใบที่ลงบัญชีแล้ว) */
export function PayrollDetailActions({ doc }: { doc: PayrollDetailDoc }) {
  const captionId = useId();
  const slips = doc.payroll?.lines.length ?? 0;
  const posted = doc.status === 'POSTED';
  return (
    <>
      {isPayrollEditable(doc) && (
        <Button asChild variant="outline" size="sm">
          <Link to={payrollEditPath(doc.id)}>
            <Pencil size={14} className="mr-1.5" aria-hidden="true" />
            แก้ไข
          </Link>
        </Button>
      )}
      {slips > 0 && doc.status !== 'VOIDED' && (
        <span className="inline-flex max-w-64 flex-col items-end gap-1">
          {posted ? (
            <Button asChild size="sm">
              <Link to={`/expenses/${doc.id}/voucher`} aria-describedby={captionId}>
                <Printer size={14} className="mr-1.5" aria-hidden="true" />
                {slipButtonLabel(slips)}
              </Link>
            </Button>
          ) : (
            <span className="cursor-not-allowed">
              <Button type="button" variant="outline" size="sm" disabled aria-describedby={captionId}>
                <Printer size={14} className="mr-1.5" aria-hidden="true" />
                {slipButtonLabel(slips)}
              </Button>
            </span>
          )}
          <span id={captionId} className="text-right text-xs leading-snug text-muted-foreground">
            {posted ? SLIP_PAPER_ONLY : SLIP_NEEDS_POST}
          </span>
        </span>
      )}
    </>
  );
}

import { useEffect, useId, useRef, type RefObject } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRightToLine, Clock, Lock, Pencil, Printer, Undo2 } from 'lucide-react';
import api from '@/lib/api';
import ScreenTable from '@/components/ui/ScreenTable';
import { Button } from '@/components/ui/button';
import { formatNumberDecimal } from '@/utils/formatters';
import { fmtOt, thaiShortDate } from '@/pages/attendance/attendance.util';
import {
  AttendanceDayLink,
  PayrollReviewPanel,
  type Viewer,
} from '@/components/expense-form-v4/payroll-system/PayrollReviewPanel';
import { isAttendanceSource, payrollPeriodShort } from '@/components/expense-form-v4/payroll-system/PayrollSystemRows';
import { clawbackCarriedOf, type StoredPayrollLine } from '@/components/expense-form-v4/payroll-system/payroll-lines';
import {
  BANK_CSV_NEEDS_POST,
  DRAFT_EDIT_CAPTION,
  NET_FOOTNOTE,
  NOT_YET_CLOSABLE_REASON,
  REVERSE_UNLOCKS_TEXT,
  SLIP_NEEDS_POST,
  SLIP_PAPER_ONLY,
  STALE_EDIT_HINT,
  attendanceLockedText,
  bankCsvSkippedText,
  carryForwardText,
  clawbackDeductedText,
  deviceConflictReason,
  deviceConflictText,
  postCutoffText,
  slipButtonLabel,
  submitCutoffText,
} from '@/components/expense-form-v4/payroll-system/payroll-copy';
import {
  PAYROLL_EDITABLE_STATUSES,
  isPayrollEditable,
  payrollEditPath,
  type PayrollConflict,
} from '@/components/expense-form-v4/payroll-system/payroll-status';
import type { PayrollGateView, PayrollStaleDiff, PayrollSystemNotes } from '@/components/expense-form-v4/types';

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
  number: string;
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

/** ด่านปิดปุ่มอยู่ไหม (ยังไม่ถึงเวลาปิดงวด หรือมีวันติดธง) — ระหว่างนี้หน้าโหลดใบใหม่เมื่อกลับมาที่หน้าต่าง และทุก 60 วินาที */
export const payrollGateBlocks = (gate: PayrollGateView | null | undefined) =>
  !!gate && (!!gate.closableAt || gate.deviceConflicts.length > 0);

/** ถามด่านซ้ำทุก 60 วินาทีระหว่างที่ปุ่มถูกปิด (นาฬิกาเครื่องคลาดจาก server · ล้างธงจากอีกเครื่อง) */
export const PAYROLL_GATE_POLL_MS = 60_000;

/** setTimeout รอได้ไม่เกิน 2^31−1 ms (~24.8 วัน) — เกินนั้นยิงทันที ⇒ ตั้งเป็นช่วง ๆ จนถึงเวลา */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * เมื่อถึงเวลาปิดงวด (+1 วินาที) โหลดใบใหม่ — server ตัดสินว่าด่านหมดหรือยัง (ไม่เปิดปุ่มจากนาฬิกาเครื่อง)
 * · ไม่มีเวลาปิดงวด = ไม่ตั้งเวลา · เปลี่ยน/ออกจากหน้า = ยกเลิก
 */
export function usePayrollGateRefresh(docId: string | undefined, closableAt: string | null | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const at = closableAt ? Date.parse(closableAt) : NaN;
    if (!docId || Number.isNaN(at)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const wait = at + 1000 - Date.now();
      if (wait <= 0) {
        queryClient.invalidateQueries({ queryKey: ['expense-document', docId] });
        return;
      }
      timer = setTimeout(arm, Math.min(wait, MAX_TIMEOUT_MS));
    };
    arm();
    return () => clearTimeout(timer);
  }, [queryClient, docId, closableAt]);
}

const DEVICE_CONFLICT_FLAG = 'DEVICE_CONFLICT';

/**
 * คำเตือนที่บอกให้ทำอะไรก่อนลงบัญชี (รอฝ่ายบัญชีตอบ / ใส่รายการหักเองในใบนี้) — หมดความหมายเมื่อใบลงบัญชี/กลับรายการแล้ว
 * (P2-R30) · ยกไปงวดหน้า และค่าคอมที่อยู่ในใบอื่น ยังเป็นข้อเท็จจริงของใบ — แสดงต่อ
 */
const PRE_POST_ONLY_WARNINGS = ['COMMISSION_FINANCE_BLOCKED', 'CLAWBACK_PAID_OUTSIDE_PAYROLL'];

/**
 * วันที่ต้องตรวจ/คำเตือนที่เก็บไว้ตอนบันทึก เทียบกับด่านสด: เวลาปิดงวดใช้แบนเนอร์แทน · ธงเครื่องถูกใช้ซ้อนที่เจ้าของล้างแล้ว
 * (ไม่อยู่ใน `gate.deviceConflicts`) ไม่แสดง และวันที่ไม่เหลือธงก็ไม่แสดง · ไม่มีด่าน (ลงบัญชี/กลับรายการแล้ว) = ตามที่เก็บ
 * · ใบที่ไม่อยู่ในสถานะแก้ไข/อนุมัติได้ ไม่แสดงคำเตือนก่อนลงบัญชี (PRE_POST_ONLY_WARNINGS)
 */
function liveReviewNotes(
  notes: PayrollSystemNotes | null | undefined,
  gate: PayrollGateView | null | undefined,
  status: string,
) {
  if (!notes) return null;
  const beforePosting = PAYROLL_EDITABLE_STATUSES.includes(status);
  const warnings = notes.warnings.filter(
    (w) => w.code !== 'NOT_YET_CLOSABLE' && (beforePosting || !PRE_POST_ONLY_WARNINGS.includes(w.code)),
  );
  if (!gate) return { ...notes, warnings };
  const stillFlagged = new Set(gate.deviceConflicts.map((d) => d.dayId));
  const review = notes.review.flatMap((day) => {
    if (!day.flags.includes(DEVICE_CONFLICT_FLAG) || stillFlagged.has(day.dayId)) return [day];
    const flags = day.flags.filter((f) => f !== DEVICE_CONFLICT_FLAG);
    return flags.length > 0 ? [{ ...day, flags, blocking: false }] : [];
  });
  return { review, warnings };
}

const money = (v: Decimal) => formatNumberDecimal(v.toFixed(2), 2);
const dec = (v: string | null | undefined) => new Decimal(v || '0');

interface LineTotals {
  base: Decimal;
  attendance: Decimal;
  commission: Decimal;
  other: Decimal;
  sso: Decimal;
  net: Decimal;
}

const isCommissionSource = (source: string) => source === 'COMMISSION';

/**
 * แยกรายได้ของบรรทัดเป็น OT/วันหยุด (จากระบบลงเวลา) · ค่าคอม (ส่วนที่ 2 — P2-R19.4) · รายได้อื่น —
 * ยอดของแต่ละแถวคือยอดที่เก็บไว้ · หักคืนค่าคอมอยู่ในสุทธิแล้ว (NET_FOOTNOTE: หลังหักรายการหักอื่น)
 */
function lineTotals(l: PayrollDetailLine): LineTotals {
  const rows = l.customIncome ?? [];
  const sum = (pick: (source: string) => boolean) =>
    rows.filter((r) => pick(r.source ?? 'MANUAL')).reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0));
  return {
    base: dec(l.baseSalary),
    attendance: sum(isAttendanceSource),
    commission: sum(isCommissionSource),
    other: sum((source) => !isAttendanceSource(source) && !isCommissionSource(source)),
    sso: dec(l.ssoEmployee),
    net: dec(l.netPaid),
  };
}

const ALL_COLUMNS: Array<[keyof LineTotals, string]> = [
  ['base', 'ฐาน'],
  ['attendance', 'OT / วันหยุด'],
  ['commission', 'ค่าคอม'],
  ['other', 'รายได้อื่น'],
  ['sso', 'SSO'],
  ['net', 'สุทธิ'],
];

/** ใบที่ไม่มีค่าคอมเลย (ฝั่ง FINANCE / ใบก่อนส่วนที่ 2) คงห้าคอลัมน์เดิม — งบความกว้างตารางข้างแผงตรวจ */
const hasCommission = (lines: PayrollDetailLine[]) =>
  lines.some(
    (l) =>
      (l.customIncome ?? []).some((r) => isCommissionSource(r.source ?? 'MANUAL')) ||
      (l.customDeduction ?? []).some((r) => r.source === 'COMMISSION_CLAWBACK'),
  );

function PayrollLinesTable({
  lines,
  headingRef,
}: {
  lines: PayrollDetailLine[];
  /** หัวตาราง — ที่วางโฟกัสเมื่อปิดแจ้งเตือนยอดเปลี่ยน */
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const titleId = useId();
  const columns = hasCommission(lines) ? ALL_COLUMNS : ALL_COLUMNS.filter(([key]) => key !== 'commission');
  const rows = lines.map((l) => {
    const clawbacks = (l.customDeduction ?? []).filter((r) => r.source === 'COMMISSION_CLAWBACK');
    return {
      line: l,
      totals: lineTotals(l),
      // ยอดที่เก็บไว้ (Σ แถวหักคืนค่าคอมของบรรทัด) — ไม่คิดใหม่
      clawback: clawbacks.length > 0 ? clawbacks.reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0)).toFixed(2) : null,
      carried: clawbackCarriedOf(l.systemNotes)?.carried,
    };
  });
  const grand = columns.reduce(
    (acc, [key]) => ({ ...acc, [key]: rows.reduce((s, r) => s.plus(r.totals[key]), new Decimal(0)) }),
    {} as LineTotals,
  );
  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-lg border border-border bg-card overflow-hidden lg:flex-1">
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="px-4 py-2 text-sm font-semibold leading-snug focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {`รายการเงินเดือน (${lines.length} คน)`}
      </h2>
      <ScreenTable className="w-full text-sm" aria-label="รายการเงินเดือน">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-medium leading-snug">พนักงาน</th>
            {columns.map(([key, label]) => (
              <th key={key} className="px-4 py-2 text-right font-medium leading-snug whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ line, totals, clawback, carried }) => (
            <tr key={line.id}>
              <td className="px-4 py-2 leading-snug">
                {line.employeeName}
                {(clawback || carried) && (
                  // หักคืนค่าคอม (ยอดที่เก็บ) · ยกไปงวดหน้า (CLAWBACK_CARRIED — ประโยคเต็มอยู่ในแผงตรวจ)
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-warning-strong leading-snug">
                    <ArrowRightToLine className="size-3 shrink-0" aria-hidden="true" />
                    {[clawback && clawbackDeductedText(clawback), carried && carryForwardText(carried)].filter(Boolean).join(' · ')}
                  </span>
                )}
              </td>
              {columns.map(([key]) => (
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
            {columns.map(([key]) => (
              <td key={key} className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                {money(grand[key])}
              </td>
            ))}
          </tr>
        </tfoot>
      </ScreenTable>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground leading-snug">{NET_FOOTNOTE}</p>
    </section>
  );
}

const diffText = (v: PayrollStaleDiff['stored']) =>
  v.hours != null ? `${fmtOt(parseFloat(v.hours))} ชม. · ${formatNumberDecimal(v.amount, 2)}` : formatNumberDecimal(v.amount, 2);

/** 409 PAYROLL_STALE — ข้อความของ server + ตาราง ในใบ/ตอนนี้ + ทางแก้ (แก้ไข → บันทึกใบใหม่ ระบบคิดยอดให้) */
function PayrollStaleAlert({
  docId,
  conflict,
  onDismiss,
}: {
  docId: string;
  conflict: PayrollConflict;
  onDismiss: () => void;
}) {
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
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link to={payrollEditPath(docId)}>
            <Pencil className="size-3.5" aria-hidden="true" />
            แก้ไข
          </Link>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDismiss}>
          ปิด
        </Button>
        <span className="text-xs text-muted-foreground leading-snug">{STALE_EDIT_HINT}</span>
      </div>
    </div>
  );
}

export function PayrollDetailSection({
  doc,
  primary,
  staleConflict,
  onDismissStale,
  viewer,
  canReverse,
}: {
  doc: PayrollDetailDoc;
  primary: PayrollPrimaryStep;
  /** 409 PAYROLL_STALE ล่าสุดจากปุ่มอนุมัติ/ลงบัญชี (หน้าเก็บไว้จนกดสำเร็จ / ปิด / ใบเปลี่ยนสถานะ) */
  staleConflict: PayrollConflict | null;
  onDismissStale: () => void;
  viewer: Viewer | null | undefined;
  /** ผู้ดูมีปุ่ม "ยกเลิก / กลับรายการ" ในแถบควบคุมภายใน (สิทธิ์ EXPENSE_CANCEL + ใบลงบัญชีแล้ว) */
  canReverse: boolean;
}) {
  const gate = doc.payrollGate;
  const lines = doc.payroll?.lines ?? [];
  const cutoffText = gate?.closableAt
    ? doc.status === 'DRAFT' && primary === 'submit'
      ? submitCutoffText(gate.closableAt)
      : postCutoffText(gate.closableAt)
    : null;
  const conflicts = gate?.deviceConflicts ?? [];
  const linesHeadingRef = useRef<HTMLHeadingElement>(null);
  // ปุ่ม "ปิด" หายไปพร้อมแจ้งเตือน — ย้ายโฟกัสไปหัวตารางบรรทัด (ไม่ให้หลุดไปที่ body)
  const dismissStale = () => {
    linesHeadingRef.current?.focus();
    onDismissStale();
  };
  const reviewLines = lines.map((l) => ({
    employeeName: l.employeeName,
    systemNotes: liveReviewNotes(l.systemNotes, gate, doc.status),
  }));
  // คนที่ผูกทะเบียน = คนที่ลงเวลาเดือนนี้ถูกล็อกเมื่อใบลงบัญชีแล้ว
  const linkedPeople = lines.filter((l) => l.userId).length;

  return (
    <div className="flex flex-col gap-4">
      {staleConflict && <PayrollStaleAlert docId={doc.id} conflict={staleConflict} onDismiss={dismissStale} />}
      {cutoffText && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 p-3">
          <Clock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-sm leading-snug text-foreground">{cutoffText}</p>
        </div>
      )}
      {conflicts.length > 0 && (
        // สถานะของใบตอนเปิดหน้า (ไม่ใช่ผลของการกด) = status · กระดาน 6A: ลิงก์ไปวันนั้นที่ ลงเวลา ทีละวัน
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm leading-snug text-foreground">{deviceConflictText(conflicts)}</p>
          </div>
          <ul className="flex flex-col gap-2 sm:pl-6">
            {conflicts.map((d) => (
              <li
                key={d.dayId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-2.5 py-1.5"
              >
                <span className="text-sm font-medium leading-snug">{d.employeeName}</span>
                <span className="text-xs text-muted-foreground leading-snug">{thaiShortDate(d.date)}</span>
                <AttendanceDayLink day={d} viewer={viewer} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {doc.status === 'POSTED' && linkedPeople > 0 && doc.payroll && (
        <ul className="grid gap-3 sm:grid-cols-2">
          <li className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm leading-snug">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{attendanceLockedText(payrollPeriodShort(doc.payroll.payrollPeriod), linkedPeople)}</span>
          </li>
          {canReverse && (
            <li className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm leading-snug">
              <Undo2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{REVERSE_UNLOCKS_TEXT}</span>
            </li>
          )}
        </ul>
      )}
      {lines.length > 0 && (
        // แผงตรวจไม่แสดงเมื่อไม่มีวันที่ต้องตรวจ/คำเตือน — ตารางจึงเต็มความกว้าง
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:[&>aside]:w-80 lg:[&>aside]:shrink-0">
          <PayrollLinesTable lines={lines} headingRef={linesHeadingRef} />
          <PayrollReviewPanel lines={reviewLines} viewer={viewer} label="ตรวจก่อนอนุมัติ" />
        </div>
      )}
    </div>
  );
}

/** ปุ่มเฉพาะใบเงินเดือนในแถบควบคุมภายใน: แก้ไข (ใบที่ยังไม่ลงบัญชี) + พิมพ์สลิป (เฉพาะใบที่ลงบัญชีแล้ว) */
export function PayrollDetailActions({ doc }: { doc: PayrollDetailDoc }) {
  const captionId = useId();
  const editCaptionId = useId();
  const slips = doc.payroll?.lines.length ?? 0;
  const posted = doc.status === 'POSTED';
  const draft = doc.status === 'DRAFT';
  return (
    <>
      {isPayrollEditable(doc) && (
        <span className="inline-flex max-w-64 flex-col items-end gap-1">
          <Button asChild variant="outline" size="sm">
            <Link to={payrollEditPath(doc.id)} aria-describedby={draft ? editCaptionId : undefined}>
              <Pencil size={14} className="mr-1.5" aria-hidden="true" />
              แก้ไข
            </Link>
          </Button>
          {draft && (
            <span id={editCaptionId} className="text-right text-xs leading-snug text-muted-foreground">
              {DRAFT_EDIT_CAPTION}
            </span>
          )}
        </span>
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

/**
 * R3-3 ไฟล์โอนเงินเดือนเข้าธนาคาร (เลขบัญชีจากทะเบียนพนักงาน · แถวที่ไม่มีเลขบัญชีถูกข้าม + แจ้งจำนวน) —
 * กระดาน 2: ดาวน์โหลดได้เมื่อใบลงบัญชีแล้ว (ยอดยังเปลี่ยนได้จนกว่าจะลงบัญชี) · ก่อนนั้นปิดพร้อมเหตุผล · ใบกลับรายการไม่มีปุ่ม
 */
export function PayrollBankCsvButton({ doc, viewerRole }: { doc: PayrollDetailDoc; viewerRole: string | undefined }) {
  const reasonId = useId();
  if (doc.status === 'VOIDED') return null;
  const posted = doc.status === 'POSTED';
  const download = async () => {
    try {
      const res = await api.get(`/expense-documents/${doc.id}/bank-transfer.csv`, { responseType: 'blob' });
      const skipped = parseInt((res.headers['x-skipped-lines'] as string) ?? '0', 10);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bank-transfer-${doc.number}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (skipped > 0) toast.warning(bankCsvSkippedText(skipped, viewerRole));
    } catch {
      toast.error('ดาวน์โหลดไฟล์โอนธนาคารไม่สำเร็จ');
    }
  };
  return (
    <div className="mt-2 flex flex-col items-end gap-1">
      <span className={posted ? undefined : 'cursor-not-allowed'}>
        <button
          data-ui-control="button"
          type="button"
          onClick={download}
          disabled={!posted}
          aria-describedby={posted ? undefined : reasonId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-60"
        >
          ไฟล์โอนธนาคาร (CSV)
        </button>
      </span>
      {!posted && (
        <span id={reasonId} className="text-xs text-muted-foreground leading-snug">
          {BANK_CSV_NEEDS_POST}
        </span>
      )}
    </div>
  );
}

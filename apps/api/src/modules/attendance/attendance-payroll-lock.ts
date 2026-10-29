import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { lockPayrollAttendance } from '../expense-documents/payroll-system/payroll-save';
import { fromDbDate, workDateString } from './attendance-rules';

/**
 * เดือนที่จ่ายเงินเดือนแล้ว = แก้ลงเวลาไม่ได้ (Payroll D4) · "จ่ายแล้ว" = มีบรรทัดของคนนั้นในใบ PAYROLL ของงวดนั้นที่ POSTED และไม่ถูกลบ
 * (ใบที่ VOIDED ปลดล็อกเอง) · ผู้เขียนลงเวลาล็อกเฉพาะ `payroll-attendance:*` (เรียงแล้ว) ก่อนตรวจ — ลำดับเดียวกับด่านลงบัญชีของใบเงินเดือน
 */
type Client = Prisma.TransactionClient | PrismaService;

export const ATTENDANCE_PAID_CODE = 'ATTENDANCE_PAID';
const paidDocument = { documentType: 'PAYROLL', status: 'POSTED', deletedAt: null } as const;

export const attendancePaidMessage = (number: string) =>
  `เดือนนี้จ่ายเงินเดือนแล้ว (ใบ ${number}) — แก้ไม่ได้ ถ้าต้องปรับ ให้ใส่แถว "รายการปรับปรุงงวดก่อน" (จ่ายเพิ่ม) หรือรายการหัก (หักคืน) ในใบเงินเดือนงวดถัดไป`;

/** 'YYYY-MM' ของวันทำงาน (workDate เป็น @db.Date) */
export const periodOfWorkDate = (workDate: Date): string => workDateString(fromDbDate(workDate)).slice(0, 7);

export async function findPaidPayroll(client: Client, userId: string, period: string): Promise<{ documentId: string; number: string } | null> {
  const line = await client.payrollLine.findFirst({
    where: { userId, payroll: { payrollPeriod: period, document: paidDocument } },
    select: { payroll: { select: { documentId: true, document: { select: { number: true } } } } },
  });
  return line ? { documentId: line.payroll.documentId, number: line.payroll.document.number } : null;
}

/** userId → เลขที่ใบเงินเดือนที่จ่ายแล้วของงวดนี้ (คนที่ยังไม่จ่ายไม่อยู่ใน map) */
export async function paidPayrollNumbers(client: Client, userIds: string[], period: string): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const lines = await client.payrollLine.findMany({
    where: { userId: { in: userIds }, payroll: { payrollPeriod: period, document: paidDocument } },
    select: { userId: true, payroll: { select: { document: { select: { number: true } } } } },
  });
  return new Map(lines.flatMap((l) => (l.userId ? [[l.userId, l.payroll.document.number] as const] : [])));
}

type Pair = { userId: string; workDate: Date };

/** ล็อกต่อ (งวด, คน) เรียงงวดแล้วคน ไม่ซ้ำ — ใบเงินเดือนล็อกงวดเดียว/คนเรียงเช่นกัน ⇒ ไม่เกิดวงจรรอ */
export async function lockAttendancePairs(tx: Prisma.TransactionClient, pairs: Pair[]): Promise<void> {
  const byPeriod = new Map<string, string[]>();
  for (const p of pairs) {
    const period = periodOfWorkDate(p.workDate);
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), p.userId]);
  }
  for (const period of [...byPeriod.keys()].sort()) await lockPayrollAttendance(tx, byPeriod.get(period)!, period);
}

/** 409 ATTENDANCE_PAID ถ้าคู่ใดอยู่ในเดือนที่จ่ายแล้ว — เรียกใน tx หลัง `lockAttendancePairs` */
export async function assertNotPaid(client: Client, pairs: Pair[]): Promise<void> {
  const seen = new Set<string>();
  for (const p of pairs) {
    const period = periodOfWorkDate(p.workDate);
    const key = `${p.userId}:${period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const paid = await findPaidPayroll(client, p.userId, period);
    if (paid) throw new ConflictException({ code: ATTENDANCE_PAID_CODE, documentNumber: paid.number, message: attendancePaidMessage(paid.number) });
  }
}

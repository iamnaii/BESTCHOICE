import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { bangkokMidnight } from '../../../utils/date.util';
import { formatDateShortThai, formatThaiDateText } from '../../../utils/thai-date.util';
import { DEVICE_CONFLICT_FLAG } from '../../attendance/attendance-device.service';
import { fromDbDate, workDateString } from '../../attendance/attendance-rules';
import { payrollCutoff, payrollDocumentLockKey } from './payroll-pay';
import { lockPayrollAttendance } from './payroll-save';
import { PayrollSystemRowsService, periodRange } from './payroll-system-rows.service';
import { ATTENDANCE_INCOME_SOURCES, type StaleDiff, type SystemIncomeRow, type SystemWarning } from './payroll-system.types';

/**
 * Payroll D4 ส่วนที่ 1 — ด่านของใบเงินเดือนที่มีบรรทัดผูกพนักงาน (ไม่มีบรรทัดผูก = ไม่มีด่าน)
 * - ส่งขออนุมัติ (`assertSubmittable`): เวลาปิดงวดอย่างเดียว — ผู้เรียกบันทึกใบซ้ำผ่านทางบันทึก (คิดแถวระบบใหม่) ต่อเอง
 * - อนุมัติ / ลงบัญชี (`assertPostable` — ผู้เรียกถือ `post:${docId}` แล้ว): ล็อกงวด + ลงเวลาของคนในใบ →
 *   (1) เวลาปิดงวด → (2) วันติดธงเครื่องถูกใช้ซ้อนของคนในใบ → (3) คิดใหม่ต้องเท่ากับที่เก็บ → (4) ไม่มีใบอื่นถือ OT ของคนเดียวกัน
 * - หน้ารายละเอียด (`inspect`): เวลาที่ส่ง/ลงบัญชีได้ (ยังไม่ถึง) + วันติดธง — อ่านอย่างเดียว ไม่ล็อก
 * ทุก 409 มี `code` + รายละเอียด (`closableAt` / `days` / `diffs` / `documentNumber`) ที่ SentryExceptionFilter ส่งต่อให้เว็บ
 */

export interface PayrollGateDay {
  dayId: string;
  userId: string;
  employeeName: string;
  /** 'YYYY-MM-DD' วันไทย */
  date: string;
}

export interface PayrollGateView {
  /** เวลาปิดงวด (ISO) เมื่อใบมีพนักงานผูกและยังไม่ถึงเวลา · null = ส่ง/ลงบัญชีได้แล้ว หรือใบไม่มีด่านนี้ */
  closableAt: string | null;
  /** วันที่ติดธงเครื่องถูกใช้ซ้อนของพนักงานที่ผูกในใบ (เดือนของงวด) — อนุมัติไม่ได้จนกว่าเจ้าของล้างธง */
  deviceConflicts: PayrollGateDay[];
}

const STALE_MESSAGE =
  'ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลาเปลี่ยนหลังบันทึกใบ ให้ผู้ทำเงินเดือนกด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง';

/** {วันที่ไทยสั้น} ของเวลาปิดงวด = "1 พ.ย. 2569" (มี พ.ศ. — กันสับสนช่วง ธ.ค. → ม.ค. · Asia/Bangkok) */
const cutoffDate = (at: Date) => formatThaiDateText(at);
/** วันในรายการวันติดธง = "15 ต.ค." (เดือนเดียวกับงวดเสมอ) */
const thaiShort = (at: Date) => formatDateShortThai(at);
const dayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return bangkokMidnight(y, m - 1, d);
};

/** 409 ของด่านใบเงินเดือน — ข้อความตามตาราง copy (global constraints) ห้ามแก้ถ้อยคำ */
export const payrollGateConflict = {
  submitCutoff: (cutoff: Date) =>
    new ConflictException({
      code: 'PAYROLL_SUBMIT_CUTOFF',
      closableAt: cutoff.toISOString(),
      message: `ส่งขออนุมัติได้ตั้งแต่ ${cutoffDate(cutoff)} 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้`,
    }),
  postCutoff: (cutoff: Date) =>
    new ConflictException({
      code: 'PAYROLL_CUTOFF',
      closableAt: cutoff.toISOString(),
      message: `ลงบัญชีได้ตั้งแต่ ${cutoffDate(cutoff)} 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน`,
    }),
  deviceConflict: (days: PayrollGateDay[]) =>
    new ConflictException({
      code: 'PAYROLL_DEVICE_CONFLICT',
      days,
      message:
        `อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน ${days.length} วัน ` +
        `(${days.map((d) => `${d.employeeName} · ${thaiShort(dayOf(d.date))}`).join(', ')}) ` +
        'ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วกด "ตรวจแล้ว ล้างธง"',
    }),
  stale: (diffs: StaleDiff[]) => new ConflictException({ code: 'PAYROLL_STALE', diffs, message: STALE_MESSAGE }),
  otherDoc: (employeeName: string, documentNumber: string) =>
    new ConflictException({
      code: 'PAYROLL_OTHER_DOC',
      documentNumber,
      message: `OT ของ ${employeeName} เดือนนี้อยู่ในใบ ${documentNumber} แล้ว — เอาออกจากใบใดใบหนึ่งก่อน`,
    }),
};

type Client = Prisma.TransactionClient | PrismaService;

interface StoredSystemRow {
  source: string;
  accountCode: string;
  name: string;
  amount: Prisma.Decimal;
  quantity: Prisma.Decimal | null;
}

interface GateLine {
  userId: string;
  employeeName: string;
  /** แถวลงเวลาที่เก็บไว้ — บรรทัดที่ระบบยังไม่เคยคิด (systemPulledAt ว่าง) ไม่มีแถวนี้ ⇒ เทียบเป็นว่าง */
  stored: StoredSystemRow[];
}

interface GateDoc {
  id: string;
  branchId: string;
  period: string;
  scope: 'SHOP' | 'FINANCE';
  /** บรรทัดที่ผูกพนักงาน ตามลำดับในใบ (มีอย่างน้อย 1) */
  lines: GateLine[];
}

const LINKED_LINES = { userId: { not: null } } satisfies Prisma.PayrollLineWhereInput;

/**
 * ใบนี้มีบรรทัดผูกพนักงานไหม — ผู้เรียกที่ไม่ได้ต่อด่านใช้ตัดสิน "ปฏิเสธ (ไม่ปล่อยผ่าน)" กับ "ใบพิมพ์ชื่อเองล้วน ทำต่อได้"
 * (ใบที่ไม่มี PayrollDetail / ไม่มีบรรทัด = ไม่มี)
 */
export async function hasLinkedPayrollLines(client: Client, documentId: string): Promise<boolean> {
  const detail = await client.payrollDetail.findUnique({
    where: { documentId },
    select: { lines: { where: LINKED_LINES, select: { id: true }, take: 1 } },
  });
  return (detail?.lines ?? []).length > 0;
}

const money = (v: Prisma.Decimal | string) => new Prisma.Decimal(v.toString()).toFixed(2);
const rowKey = (r: { source: string; accountCode: string; amount: Prisma.Decimal | string }) => `${r.source}|${r.accountCode}|${money(r.amount)}`;
const sameMultiset = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** ยอดรวม + ชั่วโมงรวม (เมื่อทุกแถวมีชั่วโมง) ของแถวชนิดเดียวกัน · ไม่มีแถว = 0.00 / null */
function summarize(rows: Array<{ amount: Prisma.Decimal | string; quantity: Prisma.Decimal | string | null }>): StaleDiff['stored'] {
  const amount = rows.reduce((s, r) => s.plus(r.amount.toString()), new Prisma.Decimal(0));
  const hours =
    rows.length > 0 && rows.every((r) => r.quantity != null)
      ? rows.reduce((s, r) => s.plus(r.quantity!.toString()), new Prisma.Decimal(0)).toFixed(1)
      : null;
  return { amount: amount.toFixed(2), hours };
}

/** เทียบแถวลงเวลาที่เก็บกับที่คิดใหม่เป็น multiset ของ (source, บัญชี, ยอด) · ต่าง = หนึ่งแถว diff ต่อชนิดแถวที่ต่าง */
function staleDiffs(line: GateLine, current: SystemIncomeRow[]): StaleDiff[] {
  if (sameMultiset(line.stored.map(rowKey), current.map(rowKey))) return [];
  return ATTENDANCE_INCOME_SOURCES.flatMap((source): StaleDiff[] => {
    const stored = line.stored.filter((r) => r.source === source);
    const fresh = current.filter((r) => r.source === source);
    if (sameMultiset(stored.map(rowKey), fresh.map(rowKey))) return [];
    return [
      {
        userId: line.userId,
        employeeName: line.employeeName,
        label: fresh[0]?.name ?? stored[0]?.name ?? source,
        stored: summarize(stored),
        current: summarize(fresh),
      },
    ];
  });
}

@Injectable()
export class PayrollPostGateService {
  constructor(private readonly systemRows: PayrollSystemRowsService) {}

  /** ส่งขออนุมัติ — ใบที่มีพนักงานผูก (รวมใบที่มีแต่พนักงานรายวัน) ส่งได้ตั้งแต่เวลาปิดงวดเท่านั้น */
  async assertSubmittable(tx: Prisma.TransactionClient, documentId: string, now: Date): Promise<void> {
    const doc = await this.load(tx, documentId);
    if (!doc) return;
    const cutoff = payrollCutoff(doc.period);
    if (now.getTime() < cutoff.getTime()) throw payrollGateConflict.submitCutoff(cutoff);
  }

  /**
   * อนุมัติ / ลงบัญชี — ผู้เรียกถือ `post:${documentId}` อยู่แล้ว (ล็อก reentrant) · ลำดับการตรวจคงที่ (1)→(4)
   * ถือล็อกงวดและลงเวลาไว้จนจบธุรกรรม ⇒ แก้ลงเวลา/บันทึกใบอื่นของคนเดียวกันระหว่างนี้ต้องรอ
   */
  async assertPostable(tx: Prisma.TransactionClient, documentId: string, now: Date): Promise<void> {
    const doc = await this.load(tx, documentId);
    if (!doc) return;
    const userIds = doc.lines.map((l) => l.userId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payrollDocumentLockKey(doc.branchId, doc.period, doc.scope)}))`;
    await lockPayrollAttendance(tx, userIds, doc.period);

    // (1) เวลาปิดงวด
    const cutoff = payrollCutoff(doc.period);
    if (now.getTime() < cutoff.getTime()) throw payrollGateConflict.postCutoff(cutoff);

    // (2) วันติดธงเครื่องถูกใช้ซ้อนของพนักงานที่ผูกในใบ (ทุกคน ไม่ว่าระบบคิด OT ให้หรือไม่)
    const days = await this.deviceConflictDays(tx, doc);
    if (days.length > 0) throw payrollGateConflict.deviceConflict(days);

    // (3) คิดใหม่ด้วยทางเดียวกับตอนบันทึก (ใบนี้เองไม่นับเป็นใบอื่น) ต้องเท่ากับที่เก็บ
    const computed = await this.systemRows.compute(tx, {
      branchId: doc.branchId,
      entityScope: doc.scope,
      payrollPeriod: doc.period,
      userIds,
      excludeDocumentId: doc.id,
      now,
    });
    const byUser = new Map(computed.rows.map((r) => [r.userId, r]));
    // compute ไม่คิดแถวให้คนที่ใบอื่นถือ OT อยู่ — คนนั้นไปตกด่าน (4) "ใบอื่น" ไม่ใช่ "ยอดเปลี่ยน"
    const heldElsewhere = (userId: string) =>
      byUser.get(userId)?.notes.warnings.find((w): w is Extract<SystemWarning, { code: 'IN_OTHER_DOCUMENT' }> => w.code === 'IN_OTHER_DOCUMENT');
    const diffs = doc.lines.flatMap((line) => {
      if (heldElsewhere(line.userId)) return [];
      const row = byUser.get(line.userId);
      if (!row) throw new Error(`payroll system rows missing for user ${line.userId}`);
      return staleDiffs(line, row.systemIncome);
    });
    if (diffs.length > 0) throw payrollGateConflict.stale(diffs);

    // (4) ใบอื่นที่ยังมีผลของงวดเดียวกันถือแถวลงเวลาของคนในใบนี้
    for (const line of doc.lines) {
      const other = heldElsewhere(line.userId);
      if (other) throw payrollGateConflict.otherDoc(line.employeeName, other.documentNumber);
    }
  }

  /** สำหรับหน้ารายละเอียด (`findOne`) — อ่านอย่างเดียว */
  async inspect(client: Client, documentId: string, now: Date): Promise<PayrollGateView> {
    const doc = await this.load(client, documentId);
    if (!doc) return { closableAt: null, deviceConflicts: [] };
    const cutoff = payrollCutoff(doc.period);
    return {
      closableAt: now.getTime() < cutoff.getTime() ? cutoff.toISOString() : null,
      deviceConflicts: await this.deviceConflictDays(client, doc),
    };
  }

  /** null = ไม่ใช่ใบเงินเดือน หรือไม่มีบรรทัดผูกพนักงาน (ไม่มีด่าน) */
  private async load(client: Client, documentId: string): Promise<GateDoc | null> {
    const detail = await client.payrollDetail.findUnique({
      where: { documentId },
      select: {
        payrollPeriod: true,
        entityScope: true,
        document: { select: { branchId: true } },
        lines: {
          where: LINKED_LINES,
          orderBy: [{ lineNo: 'asc' }, { createdAt: 'asc' }],
          select: {
            userId: true,
            employeeName: true,
            customIncome: {
              where: { source: { in: [...ATTENDANCE_INCOME_SOURCES] } },
              select: { source: true, accountCode: true, name: true, amount: true, quantity: true },
            },
          },
        },
      },
    });
    if (!detail || detail.lines.length === 0) return null;
    return {
      id: documentId,
      branchId: detail.document.branchId,
      period: detail.payrollPeriod,
      scope: detail.entityScope === 'FINANCE' ? 'FINANCE' : 'SHOP',
      lines: detail.lines.map((l) => ({ userId: l.userId!, employeeName: l.employeeName, stored: l.customIncome })),
    };
  }

  private async deviceConflictDays(client: Client, doc: GateDoc): Promise<PayrollGateDay[]> {
    const { from, to } = periodRange(doc.period);
    const nameOf = new Map(doc.lines.map((l) => [l.userId, l.employeeName]));
    const rows = await client.attendanceDay.findMany({
      where: { userId: { in: [...nameOf.keys()] }, deletedAt: null, workDate: { gte: from, lt: to }, flags: { has: DEVICE_CONFLICT_FLAG } },
      select: { id: true, userId: true, workDate: true },
      orderBy: [{ workDate: 'asc' }, { userId: 'asc' }],
    });
    return rows.map((r) => ({ dayId: r.id, userId: r.userId, employeeName: nameOf.get(r.userId)!, date: workDateString(fromDbDate(r.workDate)) }));
  }
}

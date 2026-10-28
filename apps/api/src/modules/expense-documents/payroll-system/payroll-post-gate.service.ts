import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { bangkokMidnight } from '../../../utils/date.util';
import { formatDateShortThai, formatThaiDateText } from '../../../utils/thai-date.util';
import { DEVICE_CONFLICT_FLAG } from '../../attendance/attendance-device.service';
import { fromDbDate, workDateString } from '../../attendance/attendance-rules';
import { loadCommissionState, referenceOf, type UserCommissionState } from './payroll-commission-state';
import { releaseCommissionItems, revertCommissionPayment } from './payroll-commission-items';
import { payrollCutoff, payrollDocumentLockKey } from './payroll-pay';
import { lockPayrollAttendance, lockPayrollClawback } from './payroll-save';
import { PayrollSystemRowsService, periodRange } from './payroll-system-rows.service';
import { ATTENDANCE_INCOME_SOURCES, type StaleDiff, type SystemIncomeRow, type SystemWarning } from './payroll-system.types';

/**
 * Payroll D4 ส่วนที่ 1 — ด่านของใบเงินเดือนที่มีบรรทัดผูกพนักงาน (ไม่มีบรรทัดผูก = ไม่มีด่าน)
 * - ส่งขออนุมัติ (`assertSubmittable`): เวลาปิดงวดอย่างเดียว — ผู้เรียกบันทึกใบซ้ำผ่านทางบันทึก (คิดแถวระบบใหม่) ต่อเอง
 * - อนุมัติ / ลงบัญชี (`assertPostable` — ผู้เรียกถือ `post:${docId}` แล้ว): ล็อกงวด + ลงเวลา + ค่าคอมของคนในใบ →
 *   (1) เวลาปิดงวด → (2) วันติดธงเครื่องถูกใช้ซ้อนของคนในใบ → (3) แถวลงเวลาคิดใหม่ต้องเท่ากับที่เก็บ + รายการค่าคอมที่เก็บยังจ่าย/หักได้
 *   → (4) ไม่มีใบอื่นถือ OT ของคนเดียวกัน
 * - หน้ารายละเอียด (`inspect`): เวลาที่ส่ง/ลงบัญชีได้ (ยังไม่ถึง) + วันติดธง — อ่านอย่างเดียว ไม่ล็อก
 * - ส่วนที่ 2: ลงบัญชี → `markCommissionsPaid` (รายการ PAY → ค่าคอม PAID) · กลับรายการ → `releaseOnVoid`
 * ทุก 409 มี `code` + รายละเอียด (`closableAt` / `days` / `diffs` / `documentNumber`) ที่ SentryExceptionFilter ส่งต่อให้เว็บ
 */

export interface PayrollGateDay {
  dayId: string;
  userId: string;
  employeeName: string;
  /** 'YYYY-MM-DD' วันไทย */
  date: string;
  /** สาขาของวันนั้น — หน้าเว็บพาไปหน้าลงเวลาของสาขานั้น (`/attendance?…&branchId=`) */
  branchId: string;
}

export interface PayrollGateView {
  /** เวลาปิดงวด (ISO) เมื่อใบมีพนักงานผูกและยังไม่ถึงเวลา · null = ส่ง/ลงบัญชีได้แล้ว หรือใบไม่มีด่านนี้ */
  closableAt: string | null;
  /** วันที่ติดธงเครื่องถูกใช้ซ้อนของพนักงานที่ผูกในใบ (เดือนของงวด) — อนุมัติไม่ได้จนกว่าเจ้าของล้างธง */
  deviceConflicts: PayrollGateDay[];
}

/** ส่วนที่ 2 แทนข้อความของส่วนที่ 1 (P2-R14) — ด่านนี้ตอบ stale ทั้งเมื่อแถวลงเวลาและเมื่อรายการค่าคอมเปลี่ยน */
const STALE_MESSAGE =
  'ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลา/ค่าคอมเปลี่ยนหลังบันทึกใบ ให้ผู้ทำเงินเดือนกด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง';

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
  /** กลับรายการใบที่จ่ายค่าคอม ซึ่งถูกหักคืนแล้วในใบเงินเดือนที่ลงบัญชีแล้ว (P2-R5 — เฉพาะใบ POSTED: ปุ่มกลับรายการมีเฉพาะใบนั้น) */
  voidAfterClawback: (documentNumber: string) =>
    new ConflictException({
      code: 'PAYROLL_VOID_AFTER_CLAWBACK',
      documentNumber,
      message: `กลับรายการใบนี้ไม่ได้ — ค่าคอมที่ใบนี้จ่ายถูกหักคืนแล้วในใบ ${documentNumber} ให้กลับรายการใบนั้นก่อน`,
    }),
  /** อ้างอิงอยู่ในข้อความเท่านั้น (SentryExceptionFilter ส่งต่อ code / documentNumber — ไม่มีคีย์อ้างอิง) */
  voidPartialClawback: (reference: string) =>
    new ConflictException({
      code: 'PAYROLL_VOID_PARTIAL_CLAWBACK',
      message:
        `กลับรายการใบนี้ไม่ได้ — ค่าคอม ${reference} ที่ใบนี้จ่ายถูกเรียกคืนบางส่วนแล้ว ถ้าต้องแก้ยอดของคนอื่นในใบนี้ ` +
        'ให้ใส่แถว "รายการปรับปรุงงวดก่อน" (จ่ายเพิ่ม) หรือรายการหัก (หักคืน) ในใบเงินเดือนงวดถัดไป',
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

interface StoredMoneyRow {
  accountCode: string;
  name: string;
  amount: Prisma.Decimal;
}

/** รายการค่าคอมที่ยังมีผลของบรรทัด (releasedAt ว่าง) */
interface GateItem {
  salesCommissionId: string;
  kind: 'PAY' | 'CLAWBACK';
  accountCode: string;
  amount: Prisma.Decimal;
  reference: string;
}

interface GateLine {
  userId: string;
  employeeName: string;
  /** แถวลงเวลาที่เก็บไว้ — บรรทัดที่ระบบยังไม่เคยคิด (systemPulledAt ว่าง) ไม่มีแถวนี้ ⇒ เทียบเป็นว่าง */
  stored: StoredSystemRow[];
  /** แถว COMMISSION ที่เก็บไว้ (มากสุดหนึ่งแถว) */
  commissionIncome: StoredMoneyRow[];
  /** รายการหัก COMMISSION_CLAWBACK ที่เก็บไว้ (หนึ่งแถวต่อบัญชี) */
  clawbackDeductions: StoredMoneyRow[];
  items: GateItem[];
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

const COMMISSION_REFERENCE_SELECT = {
  id: true,
  contract: { select: { contractNumber: true } },
  sale: { select: { saleNumber: true } },
} satisfies Prisma.SalesCommissionSelect;

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

/** userId ของบรรทัดที่ผูกพนักงานในใบ (เรียง ไม่ซ้ำ) — กลับรายการใช้ล็อก `payroll-clawback:*` ของคนในใบ */
export async function payrollLinkedUserIds(client: Client, documentId: string): Promise<string[]> {
  const lines = await client.payrollLine.findMany({ where: { payroll: { documentId }, ...LINKED_LINES }, select: { userId: true } });
  return [...new Set(lines.flatMap((l) => (l.userId ? [l.userId] : [])))].sort();
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

/**
 * เทียบแถวลงเวลาที่เก็บกับที่คิดใหม่เป็น multiset ของ (source, บัญชี, ยอด) · ต่าง = หนึ่งแถว diff ต่อชนิดแถวที่ต่าง
 * P2-R2 — ที่คิดใหม่กรองเหลือแถวลงเวลาก่อนเทียบ: แถว COMMISSION ของ compute ไม่ใช่ตัวเทียบ (ค่าคอมที่อนุมัติหลังส่งไม่ทำให้ stale —
 * Decision 4) — ค่าคอมตรวจด้วย `commissionDiffs` จากรายการที่เก็บแทน
 */
function staleDiffs(line: GateLine, computed: SystemIncomeRow[]): StaleDiff[] {
  const attendance: ReadonlyArray<string> = ATTENDANCE_INCOME_SOURCES;
  const current = computed.filter((r) => attendance.includes(r.source));
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

const ZERO = new Prisma.Decimal(0);
const total = (rows: Array<{ amount: Prisma.Decimal }>) => rows.reduce((s, r) => s.plus(r.amount), ZERO);
const moneyDiff = (line: Pick<GateLine, 'userId' | 'employeeName'>, label: string, stored: Prisma.Decimal, current: Prisma.Decimal): StaleDiff => ({
  userId: line.userId,
  employeeName: line.employeeName,
  label,
  stored: { amount: stored.toFixed(2), hours: null },
  current: { amount: current.toFixed(2), hours: null },
});

/**
 * P2-R2 — รายการค่าคอมของบรรทัดที่เก็บไว้ยังถูกต้องไหม (ไม่เทียบกับ compute — กติกาจ่ายได้/หักได้มาจาก `loadCommissionState` ชุดเดียว)
 * (a) Σ แถว COMMISSION = Σ รายการ PAY · (b) Σ แถว COMMISSION_CLAWBACK ต่อบัญชี = Σ รายการ CLAWBACK ต่อบัญชี ·
 * (c) ค่าคอมของรายการ PAY ยังจ่ายได้ (APPROVED · ไม่ถูกลบ · ยอดเท่ารายการ) · (d) ค่าคอมของรายการ CLAWBACK ยังหักได้
 * (CLAWED_BACK / PARTIALLY_CLAWED_BACK · มี paidAt · มีรายการ PAY ในใบที่ลงบัญชีแล้วบนบัญชีนี้ · คงเหลือหลังใบอื่น ≥ รายการ)
 * ป้าย: ชื่อแถว (a)/(b) · `ค่าคอม {อ้างอิง}` / `หักคืนค่าคอม {อ้างอิง}` (c)/(d) · ไม่มีชั่วโมง · ยอดปัจจุบัน = ที่จ่าย/หักได้ตอนนี้ (ไม่มี = 0.00)
 */
function commissionDiffs(line: GateLine, state: UserCommissionState | undefined): StaleDiff[] {
  const diffs: StaleDiff[] = [];
  const pay = line.items.filter((i) => i.kind === 'PAY');
  const claw = line.items.filter((i) => i.kind === 'CLAWBACK');

  const storedIncome = total(line.commissionIncome);
  const payTotal = total(pay);
  if (!storedIncome.equals(payTotal)) {
    diffs.push(moneyDiff(line, line.commissionIncome[0]?.name ?? `ค่าคอมมิชชัน (${pay.length} รายการ)`, storedIncome, payTotal));
  }
  const accounts = [...new Set([...line.clawbackDeductions, ...claw].map((r) => r.accountCode))].sort();
  for (const accountCode of accounts) {
    const rows = line.clawbackDeductions.filter((d) => d.accountCode === accountCode);
    const onAccount = claw.filter((i) => i.accountCode === accountCode);
    const stored = total(rows);
    const current = total(onAccount);
    if (!stored.equals(current)) diffs.push(moneyDiff(line, rows[0]?.name ?? `หักคืนค่าคอม (${onAccount.length} รายการ)`, stored, current));
  }

  for (const item of pay) {
    const payable = state?.payable.find((p) => p.id === item.salesCommissionId);
    if (!payable || !payable.amount.equals(item.amount)) {
      diffs.push(moneyDiff(line, `ค่าคอม ${item.reference}`, item.amount, payable?.amount ?? ZERO));
    }
  }
  for (const item of claw) {
    const c = state?.clawbacks.find((x) => x.id === item.salesCommissionId);
    const deductible = c && c.paidAccountCode === item.accountCode ? Prisma.Decimal.max(c.outstanding, ZERO) : ZERO;
    if (deductible.lt(item.amount)) diffs.push(moneyDiff(line, `หักคืนค่าคอม ${item.reference}`, item.amount, deductible));
  }
  return diffs;
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
    await lockPayrollClawback(tx, userIds);

    // (1) เวลาปิดงวด
    const cutoff = payrollCutoff(doc.period);
    if (now.getTime() < cutoff.getTime()) throw payrollGateConflict.postCutoff(cutoff);

    // (2) วันติดธงเครื่องถูกใช้ซ้อนของพนักงานที่ผูกในใบ (ทุกคน ไม่ว่าระบบคิด OT ให้หรือไม่)
    const days = await this.deviceConflictDays(tx, doc);
    if (days.length > 0) throw payrollGateConflict.deviceConflict(days);

    // (3) แถวลงเวลา: คิดใหม่ด้วยทางเดียวกับตอนบันทึก (ใบนี้เองไม่นับเป็นใบอื่น) ต้องเท่ากับที่เก็บ ·
    //     ค่าคอม: รายการที่เก็บยังจ่าย/หักได้ตามสถานะปัจจุบัน (อ่านใต้ `payroll-clawback:*` — ทุกบรรทัด รวมคนที่ใบอื่นถือ OT)
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
    const commissionState = doc.lines.some((l) => l.items.length > 0)
      ? await loadCommissionState(tx, { userIds, payrollPeriod: doc.period, excludeDocumentId: doc.id })
      : null;
    const diffs = doc.lines.flatMap((line) => {
      const fromCommission = commissionDiffs(line, commissionState?.get(line.userId));
      if (heldElsewhere(line.userId)) return fromCommission;
      const row = byUser.get(line.userId);
      if (!row) throw new Error(`payroll system rows missing for user ${line.userId}`);
      return [...staleDiffs(line, row.systemIncome), ...fromCommission];
    });
    if (diffs.length > 0) throw payrollGateConflict.stale(diffs);

    // (4) ใบอื่นที่ยังมีผลของงวดเดียวกันถือแถวลงเวลาของคนในใบนี้
    for (const line of doc.lines) {
      const other = heldElsewhere(line.userId);
      if (other) throw payrollGateConflict.otherDoc(line.employeeName, other.documentNumber);
    }
  }

  /**
   * ลงบัญชีแล้ว (ในธุรกรรมเดียวกับ JE หลัง PayrollTemplate) — ค่าคอมของรายการ PAY ที่ยังมีผล: APPROVED → PAID ·
   * paidAt = วันที่เอกสาร · paidAmount = ยอดรายการ · CAS ต่อแถว (id ค่าคอมเรียง — ลำดับเดียวกับ helper เรียกคืน) ·
   * ได้ ≠ 1 แถว = ค่าคอมเปลี่ยนหลังด่าน (ไม่ APPROVED / ถูกลบ / ยอดเปลี่ยน) → PAYROLL_STALE พร้อม diff ของค่าคอมนั้น ·
   * คืน id ของรายการ PAY ให้ audit `commissionItemIds`
   */
  async markCommissionsPaid(tx: Prisma.TransactionClient, documentId: string, paidAt: Date): Promise<string[]> {
    const items = await tx.payrollCommissionItem.findMany({
      where: { kind: 'PAY', releasedAt: null, payrollLine: { payroll: { documentId } } },
      select: {
        id: true,
        salesCommissionId: true,
        amount: true,
        payrollLine: { select: { userId: true, employeeName: true } },
        salesCommission: { select: COMMISSION_REFERENCE_SELECT },
      },
      orderBy: [{ salesCommissionId: 'asc' }, { id: 'asc' }],
    });
    for (const item of items) {
      const { count } = await tx.salesCommission.updateMany({
        where: { id: item.salesCommissionId, status: 'APPROVED', deletedAt: null, commissionAmount: item.amount },
        data: { status: 'PAID', paidAt, paidAmount: item.amount },
      });
      if (count === 1) continue;
      const now = await tx.salesCommission.findUnique({
        where: { id: item.salesCommissionId },
        select: { status: true, deletedAt: true, commissionAmount: true },
      });
      const current = now && now.status === 'APPROVED' && !now.deletedAt ? now.commissionAmount : ZERO;
      throw payrollGateConflict.stale([
        moneyDiff(
          { userId: item.payrollLine.userId ?? '', employeeName: item.payrollLine.employeeName },
          `ค่าคอม ${referenceOf(item.salesCommission)}`,
          item.amount,
          current,
        ),
      ]);
    }
    return items.map((i) => i.id);
  }

  /**
   * กลับรายการใบเงินเดือน (ผู้เรียกถือ `post:${documentId}` + `payroll-clawback:*` ของคนในใบ · เรียกหลังรายการกลับ JE ก่อน CAS สถานะ)
   * ใบที่ลงบัญชีแล้วเท่านั้นที่แตะแถวค่าคอม (P2-R5):
   * - ค่าคอมของรายการ PAY ถูกหักคืนแล้วในใบอื่นที่ลงบัญชีแล้ว → 409 PAYROLL_VOID_AFTER_CLAWBACK (เลขที่ใบนั้น)
   * - ค่าคอมของรายการ PAY เป็น PARTIALLY_CLAWED_BACK → 409 PAYROLL_VOID_PARTIAL_CLAWBACK (อ้างอิงค่าคอม)
   * - ไม่งั้นย้อนการจ่าย (`revertCommissionPayment` — PAID → APPROVED · CLAWED_BACK ล้าง paidAt / paidAmount / clawbackAmount)
   * แล้วปล่อยรายการทุกตัวของใบ (PAY + CLAWBACK) · ใบที่ยังไม่ลงบัญชี = ปล่อยรายการอย่างเดียว · คืน id ของรายการที่ปล่อย
   */
  async releaseOnVoid(tx: Prisma.TransactionClient, documentId: string): Promise<string[]> {
    const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id: documentId }, select: { status: true } });
    if (doc.status === 'POSTED') {
      const pay = await tx.payrollCommissionItem.findMany({
        where: { kind: 'PAY', releasedAt: null, payrollLine: { payroll: { documentId } } },
        select: { salesCommission: { select: { ...COMMISSION_REFERENCE_SELECT, status: true, paidAt: true } } },
        orderBy: [{ salesCommissionId: 'asc' }, { id: 'asc' }],
      });
      const commissionIds = pay.map((i) => i.salesCommission.id);
      if (commissionIds.length > 0) {
        const deducted = await tx.payrollCommissionItem.findMany({
          where: {
            kind: 'CLAWBACK',
            releasedAt: null,
            salesCommissionId: { in: commissionIds },
            payrollLine: { payroll: { documentId: { not: documentId }, document: { status: 'POSTED' } } },
          },
          select: { payrollLine: { select: { payroll: { select: { document: { select: { number: true } } } } } } },
        });
        const holder = deducted.map((d) => d.payrollLine.payroll.document.number).sort()[0];
        if (holder) throw payrollGateConflict.voidAfterClawback(holder);
        const partial = pay.find((i) => i.salesCommission.status === 'PARTIALLY_CLAWED_BACK');
        if (partial) throw payrollGateConflict.voidPartialClawback(referenceOf(partial.salesCommission));
        for (const { salesCommission } of pay) await revertCommissionPayment(tx, salesCommission);
      }
    }
    return releaseCommissionItems(tx, documentId, new Date());
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
              where: { source: { in: [...ATTENDANCE_INCOME_SOURCES, 'COMMISSION'] } },
              select: { source: true, accountCode: true, name: true, amount: true, quantity: true },
            },
            customDeduction: {
              where: { source: 'COMMISSION_CLAWBACK' },
              select: { accountCode: true, name: true, amount: true },
            },
            commissionItems: {
              where: { releasedAt: null },
              select: { salesCommissionId: true, kind: true, accountCode: true, amount: true, salesCommission: { select: COMMISSION_REFERENCE_SELECT } },
              orderBy: [{ salesCommissionId: 'asc' }, { id: 'asc' }],
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
      lines: detail.lines.map((l) => ({
        userId: l.userId!,
        employeeName: l.employeeName,
        stored: l.customIncome.filter((i) => i.source !== 'COMMISSION'),
        commissionIncome: l.customIncome.filter((i) => i.source === 'COMMISSION'),
        clawbackDeductions: l.customDeduction,
        items: l.commissionItems.map((i) => ({
          salesCommissionId: i.salesCommissionId,
          kind: i.kind,
          accountCode: i.accountCode,
          amount: i.amount,
          reference: referenceOf(i.salesCommission),
        })),
      })),
    };
  }

  private async deviceConflictDays(client: Client, doc: GateDoc): Promise<PayrollGateDay[]> {
    const { from, to } = periodRange(doc.period);
    const nameOf = new Map(doc.lines.map((l) => [l.userId, l.employeeName]));
    const rows = await client.attendanceDay.findMany({
      where: { userId: { in: [...nameOf.keys()] }, deletedAt: null, workDate: { gte: from, lt: to }, flags: { has: DEVICE_CONFLICT_FLAG } },
      select: { id: true, userId: true, workDate: true, branchId: true },
      orderBy: [{ workDate: 'asc' }, { userId: 'asc' }],
    });
    return rows.map((r) => ({
      dayId: r.id,
      userId: r.userId,
      employeeName: nameOf.get(r.userId)!,
      date: workDateString(fromDbDate(r.workDate)),
      branchId: r.branchId,
    }));
  }
}

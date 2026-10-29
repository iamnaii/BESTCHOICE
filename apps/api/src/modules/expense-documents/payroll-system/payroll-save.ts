import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PayrollCommissionItemKind, PayrollDeductionSource, PayrollIncomeSource } from '@prisma/client';
import type { UpdatePayrollDto } from '../dto/create-payroll.dto';
import { assertDeductionsWithinGross } from '../services/payroll-custom.service';
import { payrollAttendanceLockKey, payrollClawbackLockKey } from './payroll-pay';
import type { PayrollSystemRowsService } from './payroll-system-rows.service';
import type { AttendanceSummarySnapshot, SystemNotes, SystemRowsQuery, SystemRowsResult, SystemWarning } from './payroll-system.types';

/**
 * Payroll D4 ส่วนที่ 1 — ทางบันทึกใบเงินเดือน (สร้าง / แก้ / สร้างจากแม่แบบ / ตอนส่งขออนุมัติ) เป็นเจ้าของแถวระบบ:
 * ทุกบรรทัดที่ผูกพนักงานได้แถว OT / ทำงานวันหยุด / OT วันหยุดที่ server คิดใหม่ทุกครั้งที่บันทึก (client ไม่ส่งแถวระบบ)
 * แล้วจึงคิด netPaid ต่อบรรทัด + ยอดหัวใบ · V18 และ "สุทธิไม่ติดลบ" ตรวจบนบรรทัดที่รวมแถวระบบแล้ว
 * ส่วนที่ 2 — แถว COMMISSION + รายการหักคืนค่าคอม (COMMISSION_CLAWBACK) + รายการ PAY/CLAWBACK (`commissionItems`) จาก compute ·
 * รายการหักที่ client ส่งเป็น MANUAL เสมอ (P2-R3) · netPaid / netPayment หักรายการหักทั้งหมดรวมหักคืนค่าคอม
 */

const ZERO = new Prisma.Decimal(0);

/** ข้อความตามตาราง copy (global constraints) — ห้ามแก้ถ้อยคำ */
export const manualOtDuplicateMessage = (name: string) =>
  `${name} มีแถว OT ที่กรอกเองซ้ำกับ OT จากระบบลงเวลา — ลบแถวนั้น หรือติ๊ก "รายการปรับปรุงงวดก่อน" ถ้าเป็นการแก้ OT ของเดือนก่อน`;
export const notInBranchMessage = (name: string) =>
  `${name} ไม่ใช่พนักงานของสาขานี้ — ให้เจ้าของหรือฝ่ายบัญชีทำใบเงินเดือนนี้`;
export const clawbackDuplicateMessage = (name: string) =>
  `${name} มีรายการหักบนบัญชีค่าคอมที่กรอกเองซ้ำกับหักคืนค่าคอมจากระบบ — ลบแถวนั้นออก`;
export const COMMISSION_TAKEN_MESSAGE = 'ค่าคอมบางรายการอยู่ในใบเงินเดือนอื่นแล้ว — บันทึกใบอีกครั้งเพื่อให้ระบบคิดยอดใหม่';

/** บรรทัดหลังตรวจฝั่ง client แล้ว (ทะเบียน · V17 · V19) — มีเฉพาะแถวที่ client ส่ง (MANUAL / ADJUSTMENT) */
export interface ClientPayrollLine {
  userId: string | null;
  employeeName: string;
  employeeTaxId: string | null;
  baseSalary: Prisma.Decimal;
  ssoEmployee: Prisma.Decimal;
  whtAmount: Prisma.Decimal;
  customIncome: Array<{ accountCode: string; name: string; amount: Prisma.Decimal; isTaxable: boolean; source: 'MANUAL' | 'ADJUSTMENT' }>;
  /** รายการหักที่ client ส่ง = MANUAL เสมอ (P2-R3) — แถวหักคืนค่าคอมเป็นของระบบเท่านั้น */
  customDeduction: Array<{ accountCode: string; name: string; amount: Prisma.Decimal; source: 'MANUAL' }>;
}

export interface SavedPayrollIncome {
  accountCode: string;
  name: string;
  amount: Prisma.Decimal;
  isTaxable: boolean;
  source: PayrollIncomeSource;
  quantity: Prisma.Decimal | null;
  rate: Prisma.Decimal | null;
  multiplier: Prisma.Decimal | null;
}

export interface SavedPayrollDeduction {
  accountCode: string;
  name: string;
  amount: Prisma.Decimal;
  source: PayrollDeductionSource;
}

/** รายการค่าคอมที่บรรทัดนี้จ่าย (PAY) / หักคืน (CLAWBACK) — เก็บเป็น `PayrollCommissionItem` (ช่องแสดงผลของ compute ไม่เก็บ) */
export interface SavedCommissionItem {
  salesCommissionId: string;
  kind: PayrollCommissionItemKind;
  accountCode: string;
  amount: Prisma.Decimal;
}

/** บรรทัดที่พร้อมเก็บ: แถว client + แถวระบบ · netPaid คิดจากทั้งหมด · lineNo ตามลำดับ payload */
export interface SavedPayrollLine extends Omit<ClientPayrollLine, 'customIncome' | 'customDeduction'> {
  lineNo: number;
  netPaid: Prisma.Decimal;
  customIncome: SavedPayrollIncome[];
  /** MANUAL ของ client ตามลำดับที่ส่ง แล้วตามด้วยหักคืนค่าคอมของระบบ (COMMISSION_CLAWBACK) */
  customDeduction: SavedPayrollDeduction[];
  commissionItems: SavedCommissionItem[];
  /** เวลาที่คิดแถวระบบให้บรรทัดนี้ (บรรทัดไม่ผูกพนักงาน = null) */
  systemPulledAt: Date | null;
  attendanceSummary: AttendanceSummarySnapshot | null;
  systemNotes: SystemNotes | null;
}

export interface PayrollTotals {
  /** Σ ฐานเงินเดือน */
  subtotal: Prisma.Decimal;
  /** Σ (ฐาน + รายได้พิเศษทั้งหมด) — ยอดก่อนหัก ใช้กับเกณฑ์อนุมัติ */
  totalAmount: Prisma.Decimal;
  withholdingTax: Prisma.Decimal;
  /** Σ netPaid — ขา Cr เงินสดของ PayrollTemplate */
  netPayment: Prisma.Decimal;
}

export interface MergePayrollOptions {
  /**
   * ใบจากปุ่มใช้แม่แบบ (คำตัดสินเจ้าของ 2026-10-29 · แม่แบบเงินเดือนตั้งเป็นบิลประจำไม่ได้): แถว OT ที่กรอกเอง (MANUAL บนบัญชีลงเวลา) ของบรรทัดที่ระบบคิด OT ให้
   * ถูกตัดออกพร้อมคำเตือน `TYPED_OT_REMOVED` แทนการปฏิเสธ MANUAL_OT_DUPLICATE — ไม่มีคนอยู่หน้าฟอร์มให้ลบแถวเอง ·
   * ทางฟอร์ม/แก้ร่าง/ส่งขออนุมัติไม่ส่งค่านี้ (ยังปฏิเสธตามเดิม)
   */
  stripTypedOt?: boolean;
}

/** ล็อก `payroll-attendance:${userId}:${period}` เรียง userId + ไม่ซ้ำ (ลำดับเดียวกับผู้เขียนลงเวลา) */
export async function lockPayrollAttendance(tx: Prisma.TransactionClient, userIds: string[], period: string): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payrollAttendanceLockKey(userId, period)}))`;
  }
}

/**
 * ล็อก `payroll-clawback:${userId}` เรียง userId + ไม่ซ้ำ (P2-R1) — หลัง `payroll-attendance:*` ในบันทึก / ส่ง / อนุมัติ / ลงบัญชี ·
 * หลัง `post:` ในกลับรายการ (ก่อนตรวจงวดและก่อนรายการกลับ JE ซึ่งถือล็อกเลข JE รายเดือน) ⇒ ยอดหักคืนคงเหลือที่ compute อ่าน
 * คงที่จนจบธุรกรรม (Decision 1) · ผู้เขียนหักคืน (helper / cron / ยกเลิกใบขาย / ยกเลิกสัญญา) ไม่ถือล็อกนี้
 */
export async function lockPayrollClawback(tx: Prisma.TransactionClient, userIds: string[]): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payrollClawbackLockKey(userId)}))`;
  }
}

/**
 * P2002 ของดัชนี `payroll_commission_items_one_active_pay` — Prisma 6 ไม่ใส่ชื่อดัชนีใน meta: เขียนตรง = { modelName:
 * 'PayrollCommissionItem', target: ['sales_commission_id'] } · เขียนซ้อนจาก expenseDocument.create/update (ทางที่ใช้จริง) =
 * { modelName: 'ExpenseDocument', target: ['sales_commission_id'] } (พิสูจน์ใน payroll-commission-flow.integration.spec.ts) ⇒
 * ต้องจับที่ target ด้วย · ไม่มี unique อื่นในการเขียนนี้ที่มีคอลัมน์ sales_commission_id
 */
function isCommissionTaken(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const meta = (e.meta ?? {}) as { modelName?: unknown; target?: unknown };
  const target = Array.isArray(meta.target) ? meta.target.map(String) : typeof meta.target === 'string' ? [meta.target] : [];
  return (
    meta.modelName === 'PayrollCommissionItem' ||
    target.some((t) => t === 'sales_commission_id' || t === 'payroll_commission_items_one_active_pay')
  );
}

/**
 * P2-R4 — เขียนบรรทัดใบเงินเดือน (สร้าง/แก้) ที่ชนดัชนีรายการ PAY ที่ยังมีผล → 409 PAYROLL_COMMISSION_TAKEN ทันที
 * (ธุรกรรมถูก abort แล้ว — ห้ามรัน query ต่อ) · unique อื่นผ่านออกไปตามเดิม · ปกติเกิดไม่ได้เพราะ compute อ่านใต้ `payroll-clawback:*`
 */
export async function writeWithCommissionGuard<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (isCommissionTaken(e)) throw new ConflictException({ code: 'PAYROLL_COMMISSION_TAKEN', message: COMMISSION_TAKEN_MESSAGE });
    throw e;
  }
}

/**
 * ต้องเรียกใน tx หลังล็อก `payroll:${branchId}:${period}:${scope}` — ล็อกลงเวลาของคนในใบ → compute → รวมแถว
 * ไม่มีบรรทัดที่ผูกพนักงาน = ไม่แตะ compute (ใบที่มีแต่ชื่อพิมพ์เองใช้ได้แม้ไม่ได้ต่อ service)
 */
export async function attachSystemRows(
  tx: Prisma.TransactionClient,
  service: PayrollSystemRowsService | undefined,
  lines: ClientPayrollLine[],
  q: Omit<SystemRowsQuery, 'userIds'>,
  opts: MergePayrollOptions = {},
): Promise<{ lines: SavedPayrollLine[]; totals: PayrollTotals }> {
  const userIds = [...new Set(lines.flatMap((l) => (l.userId ? [l.userId] : [])))].sort();
  let system: SystemRowsResult | null = null;
  if (userIds.length > 0) {
    if (!service) throw new Error('PayrollSystemRowsService not wired');
    await lockPayrollAttendance(tx, userIds, q.payrollPeriod);
    await lockPayrollClawback(tx, userIds);
    system = await service.compute(tx, { ...q, userIds });
  }
  return mergePayrollLines(lines, system, q.now, opts);
}

const sum = (rows: Array<{ amount: Prisma.Decimal }>) => rows.reduce((s, r) => s.plus(r.amount), ZERO);
const withRemovedWarning = (notes: SystemNotes, w: SystemWarning | undefined): SystemNotes =>
  w ? { ...notes, warnings: [w, ...notes.warnings] } : notes;
const dec = (v: string | null) => (v == null ? null : new Prisma.Decimal(v));

/** ฟังก์ชันบริสุทธิ์ — รวมแถวระบบเข้าบรรทัด · MANUAL_OT_DUPLICATE (หรือตัดแถวเมื่อ `stripTypedOt`) · CLAWBACK_DUPLICATE · V18 · สุทธิไม่ติดลบ · ยอดหัวใบ */
export function mergePayrollLines(
  input: ClientPayrollLine[],
  system: SystemRowsResult | null,
  now: Date,
  opts: MergePayrollOptions = {},
): { lines: SavedPayrollLine[]; totals: PayrollTotals } {
  const byUser = new Map((system?.rows ?? []).map((r) => [r.userId, r]));
  const attendanceCodes = new Set(system?.attendanceAccountCodes ?? []);

  // บรรทัดที่ระบบคิด OT ให้ (รายเดือน + มีเงินเดือนในทะเบียน) **และ** เดือนนี้มีวันที่ตอกเข้าของคนนั้น ห้ามมีแถว OT กรอกเอง —
  // เว้นแต่ติ๊ก "รายการปรับปรุงงวดก่อน" (ADJUSTMENT) · R20/R23: ไม่มีวันที่ตอกเลย (ไม่มีรหัส / สาขาไม่มีเครื่อง / ส่วนกลาง / ก่อนเริ่มใช้ /
  // มีแค่แถววางแผนวันหยุด-ลา) ระบบไม่คิด OT ให้ ⇒ แถวที่กรอกเองรับเป็น MANUAL · มีวันที่ตอกทีหลัง = ตอนส่ง/บันทึกครั้งถัดไปกติกานี้กลับมาใช้
  const isTypedOt = (i: ClientPayrollLine['customIncome'][number]) => i.source === 'MANUAL' && attendanceCodes.has(i.accountCode);
  const otCounted = (l: ClientPayrollLine) => {
    const r = l.userId ? byUser.get(l.userId) : undefined;
    return !!r?.autoOtEligible && !!r.attendanceTracked;
  };
  const removed = new Map<number, SystemWarning>();
  const lines = opts.stripTypedOt
    ? input.map((l, idx) => {
        const typed = otCounted(l) ? l.customIncome.filter(isTypedOt) : [];
        if (typed.length === 0) return l;
        removed.set(idx, { code: 'TYPED_OT_REMOVED', count: typed.length, amount: sum(typed).toFixed(2) });
        return { ...l, customIncome: l.customIncome.filter((i) => !isTypedOt(i)) };
      })
    : input;
  const duplicated = lines.filter((l) => otCounted(l) && l.customIncome.some(isTypedOt));
  if (duplicated.length > 0) {
    throw new BadRequestException({
      code: 'MANUAL_OT_DUPLICATE',
      message: manualOtDuplicateMessage(duplicated.map((l) => l.employeeName).join(', ')),
    });
  }

  // P2-R7 — บรรทัด (SHOP) ที่ระบบหักคืนค่าคอมให้ ห้ามมีรายการหัก MANUAL บนบัญชีค่าคอม (รหัส role ปัจจุบัน + บัญชีของทุกแถวหักคืน)
  // ไม่ขึ้นกับเกณฑ์ OT / ข้อมูลลงเวลา · ไม่เทียบยอด (แถวที่เก็บแล้วส่งกลับมาทั้งที่ยอดเปลี่ยน คือเคสที่กติกานี้มีไว้กัน)
  const commissionCodes = new Set(system?.commissionAccountCodes ?? []);
  const clawbackDuplicated = lines.filter((l) => {
    const r = l.userId ? byUser.get(l.userId) : undefined;
    return !!r && r.systemDeductions.length > 0 && l.customDeduction.some((d) => d.source === 'MANUAL' && commissionCodes.has(d.accountCode));
  });
  if (clawbackDuplicated.length > 0) {
    throw new BadRequestException({
      code: 'PAYROLL_CLAWBACK_DUPLICATE',
      message: clawbackDuplicateMessage(clawbackDuplicated.map((l) => l.employeeName).join(', ')),
    });
  }

  const saved = lines.map((l, idx): SavedPayrollLine => {
    const r = l.userId ? byUser.get(l.userId) : undefined;
    if (l.userId && !r) throw new Error(`payroll system rows missing for user ${l.userId}`);
    const customIncome: SavedPayrollIncome[] = [
      ...l.customIncome.map((i) => ({ ...i, quantity: null, rate: null, multiplier: null })),
      ...(r?.systemIncome ?? []).map((s) => ({
        accountCode: s.accountCode,
        name: s.name,
        amount: new Prisma.Decimal(s.amount),
        isTaxable: s.isTaxable,
        source: s.source,
        quantity: dec(s.quantity),
        rate: dec(s.rate),
        multiplier: dec(s.multiplier),
      })),
    ];
    const customDeduction: SavedPayrollDeduction[] = [
      ...l.customDeduction,
      ...(r?.systemDeductions ?? []).map((d) => ({
        accountCode: d.accountCode,
        name: d.name,
        amount: new Prisma.Decimal(d.amount),
        source: d.source,
      })),
    ];
    const commissionItems: SavedCommissionItem[] = (r?.commissionItems ?? []).map((i) => ({
      salesCommissionId: i.salesCommissionId,
      kind: i.kind,
      accountCode: i.accountCode,
      amount: new Prisma.Decimal(i.amount),
    }));
    assertDeductionsWithinGross({ employeeName: l.employeeName, baseSalary: l.baseSalary, customIncome, customDeduction });
    const sumIncome = sum(customIncome);
    const sumDeduction = sum(customDeduction);
    // สุทธิ = ฐาน + รายได้ทั้งหมด (รวมแถวระบบ) − SSO − WHT − รายการหักทั้งหมด (รวมหักคืนค่าคอม)
    const netPaid = l.baseSalary.plus(sumIncome).minus(l.ssoEmployee).minus(l.whtAmount).minus(sumDeduction);
    if (netPaid.lt(0)) {
      throw new BadRequestException(
        `พนักงาน "${l.employeeName}" — เงินสุทธิติดลบ ` +
          `(ฐาน ${l.baseSalary} + รายได้พิเศษ ${sumIncome} - SSO ${l.ssoEmployee} - WHT ${l.whtAmount} - หัก ${sumDeduction})`,
      );
    }
    return {
      ...l,
      lineNo: idx + 1,
      netPaid,
      customIncome,
      customDeduction,
      commissionItems,
      systemPulledAt: r ? now : null,
      attendanceSummary: r ? r.attendanceSummary : null,
      systemNotes: r ? withRemovedWarning(r.notes, removed.get(idx)) : null,
    };
  });

  return {
    lines: saved,
    totals: {
      subtotal: saved.reduce((s, l) => s.plus(l.baseSalary), ZERO),
      totalAmount: saved.reduce((s, l) => s.plus(l.baseSalary).plus(sum(l.customIncome)), ZERO),
      withholdingTax: saved.reduce((s, l) => s.plus(l.whtAmount), ZERO),
      netPayment: saved.reduce((s, l) => s.plus(l.netPaid), ZERO),
    },
  };
}

/**
 * DTO ยอดเงินเป็น number (รูปเดียวกับ JSON ที่ฟอร์มส่ง) — Decimal(12,2) มีไม่เกิน 12 หลักนัยสำคัญ ⇒ แปลงไป-กลับผ่าน double
 * ได้ค่าเดิมทุกสตางค์ (`new Prisma.Decimal(n)` ใช้ทศนิยมสั้นสุดของ n) · ทางบันทึกแปลงกลับเป็น Decimal ทันทีก่อนคิดเงิน
 */
const dtoAmount = (v: Prisma.Decimal) => v.toNumber();

/**
 * ตอนส่งขออนุมัติ: ประกอบ DTO แก้ใบจากที่เก็บไว้ ให้ `updatePayrollInTx` คิดแถวระบบใหม่แล้วเก็บซ้ำ
 * - แถวรายได้ที่ส่ง = เฉพาะที่คนกรอก (MANUAL) + รายการปรับปรุงงวดก่อน (ADJUSTMENT → `isAdjustment: true`
 *   ไม่งั้นกลายเป็น MANUAL แล้วชน MANUAL_OT_DUPLICATE) · แถวระบบ (ATTENDANCE_* / COMMISSION) ไม่ส่ง — คิดใหม่เสมอ
 * - รายการหักที่ส่ง = เฉพาะ MANUAL (P2-R3) — หักคืนค่าคอม (COMMISSION_CLAWBACK) คิดใหม่เสมอ ไม่งั้นชน CLAWBACK_DUPLICATE /
 *   หักซ้ำ · บรรทัดผูกพนักงานส่งแค่ userId (ชื่อ/เลขผู้เสียภาษีอ่านจากทะเบียนใหม่) · บรรทัดพิมพ์ชื่อส่งชื่อ+เลขเดิม
 */
export async function storedPayrollUpdateDto(tx: Prisma.TransactionClient, documentId: string): Promise<UpdatePayrollDto> {
  const doc = await tx.expenseDocument.findUniqueOrThrow({
    where: { id: documentId },
    select: {
      documentDate: true,
      depositAccountCode: true,
      description: true,
      paymentMethod: true,
      reference: true,
      note: true,
      payroll: {
        select: {
          payrollPeriod: true,
          entityScope: true,
          lines: {
            orderBy: [{ lineNo: 'asc' }, { createdAt: 'asc' }],
            select: {
              userId: true,
              employeeName: true,
              employeeTaxId: true,
              baseSalary: true,
              ssoEmployee: true,
              whtAmount: true,
              customIncome: {
                where: { source: { in: ['MANUAL', 'ADJUSTMENT'] } },
                orderBy: { createdAt: 'asc' },
                select: { accountCode: true, name: true, amount: true, isTaxable: true, source: true },
              },
              customDeduction: { where: { source: 'MANUAL' }, orderBy: { createdAt: 'asc' }, select: { accountCode: true, name: true, amount: true } },
            },
          },
        },
      },
    },
  });
  if (!doc.payroll) throw new BadRequestException('ใบเงินเดือนนี้ไม่มีรายละเอียดบรรทัด — กด "แก้ไข" แล้วบันทึกใหม่');
  return {
    documentDate: doc.documentDate.toISOString(),
    payrollPeriod: doc.payroll.payrollPeriod,
    entityScope: doc.payroll.entityScope === 'FINANCE' ? 'FINANCE' : 'SHOP',
    depositAccountCode: doc.depositAccountCode ?? '',
    description: doc.description ?? undefined,
    paymentMethod: doc.paymentMethod ?? undefined,
    reference: doc.reference ?? undefined,
    note: doc.note ?? undefined,
    lines: doc.payroll.lines.map((l) => ({
      ...(l.userId ? { userId: l.userId } : { employeeName: l.employeeName, employeeTaxId: l.employeeTaxId ?? undefined }),
      baseSalary: dtoAmount(l.baseSalary),
      ssoEmployee: dtoAmount(l.ssoEmployee),
      whtAmount: dtoAmount(l.whtAmount),
      customIncome: l.customIncome.map((i) => ({
        accountCode: i.accountCode,
        name: i.name,
        amount: dtoAmount(i.amount),
        isTaxable: i.isTaxable,
        isAdjustment: i.source === 'ADJUSTMENT',
      })),
      customDeduction: l.customDeduction.map((d) => ({ accountCode: d.accountCode, name: d.name, amount: dtoAmount(d.amount) })),
    })),
  };
}

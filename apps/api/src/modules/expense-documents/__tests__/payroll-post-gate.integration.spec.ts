import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Prisma, PrismaClient, type AttendanceDayKind, type EmploymentType, type UserRole } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { AuditService } from '../../audit/audit.service';
import { AttendanceSettingsService } from '../../attendance/attendance-settings.service';
import { AttendanceService } from '../../attendance/attendance.service';
import { KioskPunchService } from '../../attendance/kiosk-punch.service';
import { dbDate } from '../../attendance/attendance-rules';
import { bangkokMidnight } from '../../../utils/date.util';
import { SsoConfigService } from '../../sso-config/sso-config.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { AccountRoleService } from '../../journal/account-role.service';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';
import { ExpenseDocumentCreateService } from '../services/expense-document-create.service';
import { ExpenseDocumentLifecycleService } from '../services/expense-document-lifecycle.service';
import { ExpenseDocumentQueryService } from '../services/expense-document-query.service';
import { LineAggregatorService } from '../services/line-aggregator.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { PayrollCustomService } from '../services/payroll-custom.service';
import { PettyCashService } from '../services/petty-cash.service';
import { PayrollSystemRowsService } from '../payroll-system/payroll-system-rows.service';
import { PayrollPostGateService } from '../payroll-system/payroll-post-gate.service';

/**
 * Payroll D4 ส่วนที่ 1 · Task 5 — ด่านส่งขออนุมัติ / อนุมัติ / ลงบัญชีใบเงินเดือน (Postgres จริง · migrations อย่างเดียว ไม่มี seed)
 * - ส่งขออนุมัติได้ตั้งแต่ 18:00 วันที่ 1 ของเดือนถัดไป (ทุกใบที่มีพนักงานผูก) และตอนส่ง ระบบคิดแถวระบบใหม่แล้วเก็บซ้ำ
 * - อนุมัติ (ก่อนเปลี่ยนสถานะเสมอ แม้ปิด auto-post) / ลงบัญชี: ล็อก → เวลาปิดงวด → วันติดธงเครื่องถูกใช้ซ้อน →
 *   คิดใหม่ต้องเท่าที่เก็บ (ตารางยอดต่าง) → ไม่มีใบอื่นถือ OT ของคนเดียวกันในงวดเดียวกัน
 * - findOne ส่ง payrollGate ให้หน้ารายละเอียด · ไม่ได้ต่อ service = ไม่ปล่อยผ่าน
 * เวลาใช้ vi.useFakeTimers({ toFake: ['Date'] }) — งวด ต.ค. 2569 ปิด 1 พ.ย. 2569 18:00 (2026-11-01T11:00:00.000Z)
 * รัน: bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-post-gate.integration.spec.ts
 */

const prisma = new PrismaClient();
const audit = new AuditService(prisma as never);
const settings = new AttendanceSettingsService(prisma as never);
const systemRows = new PayrollSystemRowsService(settings);
const gate = new PayrollPostGateService(systemRows);
const storage = { upload: async () => undefined, delete: async () => undefined };
const attendance = new AttendanceService(prisma as never, audit, settings, storage as never);
const kiosk = new KioskPunchService(prisma as never, settings, storage as never);
const stamp = Date.now();
let seq = 0;
const docNumber = { next: async () => `PR-GATE-${stamp}-${++seq}` } as never;
const creator = new ExpenseDocumentCreateService(
  prisma as never,
  docNumber,
  new LineAggregatorService(),
  new StatusTransitionService(),
  new SsoConfigService(prisma as never),
  new PayrollCustomService(prisma as never),
  new PettyCashService(prisma as never),
  systemRows,
);
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const roles = new AccountRoleService(prisma as never, audit);
const payrollTemplate = new PayrollTemplate(journal, prisma as never, roles, companyResolver);
const unexpected = () => ({ execute: async () => { throw new Error('only the payroll template runs in this spec'); } }) as never;
const buildLifecycle = (wired: { creator?: ExpenseDocumentCreateService; gate?: PayrollPostGateService }) =>
  new ExpenseDocumentLifecycleService(
    prisma as never,
    new StatusTransitionService(),
    unexpected(),
    unexpected(),
    unexpected(),
    payrollTemplate,
    unexpected(),
    unexpected(),
    unexpected(),
    journal,
    undefined,
    undefined,
    wired.creator,
    wired.gate,
  );
const lifecycle = buildLifecycle({ creator, gate });
const query = new ExpenseDocumentQueryService(prisma as never, undefined as never, gate);

const PERIOD = '2026-10';
const MONTH0 = 9;
const CLOSABLE_AT = '2026-11-01T11:00:00.000Z';
const SUBMIT_CUTOFF = 'ส่งขออนุมัติได้ตั้งแต่ 1 พ.ย. 2569 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้';
const POST_CUTOFF = 'ลงบัญชีได้ตั้งแต่ 1 พ.ย. 2569 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน';
// D4 ส่วนที่ 2 (P2-R14) — ข้อความ STALE ฉบับที่ครอบทั้งลงเวลาและค่าคอม
const STALE = 'ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลา/ค่าคอมเปลี่ยนหลังบันทึกใบ ให้ผู้ทำเงินเดือนกด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง';
const OT_LABEL = 'OT วันทำงาน (1.5 เท่า)';

const userIds: string[] = [];
const branchIds: string[] = [];
const deviceIds: string[] = [];
let ownerId: string;
const OWNER = () => ({ id: ownerId, branchId: null, role: 'OWNER' });

/** 'YYYY-MM-DD HH:mm' เวลาไทย */
const bkk = (s: string) => new Date(`${s.replace(' ', 'T')}:00+07:00`);
const setNow = (s: string) => vi.setSystemTime(bkk(s));
const SAVED = '2026-10-31 20:00'; // บันทึกร่างก่อนเวลาปิดงวด
const BEFORE = '2026-11-01 17:59';
const AFTER = '2026-11-01 18:01';

async function setConfig(key: string, value: string | null) {
  if (value === null) {
    await prisma.systemConfig.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemConfig.upsert({ where: { key }, update: { value, deletedAt: null }, create: { key, value } });
}

async function mkBranch(tag: string) {
  const b = await prisma.branch.create({ data: { name: `สาขา GATE-${tag} ${stamp}`, workStart: '10:00', workEnd: '19:00' }, select: { id: true } });
  branchIds.push(b.id);
  return b.id;
}

async function mkUser(
  tag: string,
  branchId: string,
  o: { role?: UserRole; profile?: { employmentType: EmploymentType; baseSalary: number | null } | null; pin?: boolean } = {},
) {
  const user = await prisma.user.create({
    data: { email: `gate-${tag}-${stamp}@test.local`, password: 'x', name: `พนักงาน ${tag}`, role: o.role ?? 'SALES', isActive: true, branchId, attendancePinHash: o.pin === false ? null : `pin-${tag}-${stamp}` },
  });
  userIds.push(user.id);
  const profile = o.profile === undefined ? { employmentType: 'MONTHLY' as const, baseSalary: 16500 } : o.profile;
  if (profile) await prisma.employeeProfile.create({ data: { userId: user.id, employmentType: profile.employmentType, baseSalary: profile.baseSalary } });
  return user.id;
}

const day = (d: number) => bangkokMidnight(2026, MONTH0, d);
const atDay = (d: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day(d).getTime() + (h * 60 + m) * 60_000);
};

async function mkDay(userId: string, branchId: string, d: number, o: { kind?: AttendanceDayKind; in?: string; out?: string; ot?: number; flags?: string[] } = {}) {
  return prisma.attendanceDay.create({
    data: {
      userId,
      branchId,
      workDate: dbDate(day(d)),
      dayKind: o.kind ?? 'WORK',
      clockIn: o.in ? atDay(d, o.in) : null,
      clockOut: o.out ? atDay(d, o.out) : null,
      otHours: o.ot ?? 0,
      flags: o.flags ?? [],
    },
  });
}
/** วันทำงาน 10:00–20:30 = OT 1.5 ชม. (เวลาเลิกงาน 19:00) */
const otDay = (userId: string, branchId: string, d: number, flags: string[] = []) => mkDay(userId, branchId, d, { in: '10:00', out: '20:30', ot: 1.5, flags });

const createDoc = (branchId: string, lines: unknown[]) =>
  creator.createPayroll(
    { branchId, documentDate: '2026-10-31', payrollPeriod: PERIOD, entityScope: 'SHOP', depositAccountCode: 'S11-1202', paymentMethod: 'BANK_TRANSFER', lines } as never,
    OWNER(),
  );

const money = (v: Prisma.Decimal | string | number | null | undefined) => (v == null ? null : new Prisma.Decimal(v.toString()).toFixed(2));
const statusOf = async (id: string) => (await prisma.expenseDocument.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
/** R20 FX2 — `updatedAt` ของใบตามที่หน้ารายละเอียดวาด · อนุมัติ/ลงบัญชีใบ PAYROLL ต้องส่งกลับเป็น `expectedUpdatedAt` */
const versionOf = async (id: string) => (await prisma.expenseDocument.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt.toISOString();
const approveAsSeen = async (id: string, l: ExpenseDocumentLifecycleService = lifecycle) => l.approve(id, ownerId, 'OWNER', { expectedUpdatedAt: await versionOf(id) });
const postAsSeen = async (id: string, l: ExpenseDocumentLifecycleService = lifecycle) => l.post(id, ownerId, undefined, { expectedUpdatedAt: await versionOf(id) });

async function expectConflict(p: Promise<unknown>, body: Record<string, unknown>) {
  const err = await p.then(
    () => { throw new Error('expected a 409'); },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).getResponse()).toEqual(body);
}

async function storedRows(documentId: string) {
  const lines = await prisma.payrollLine.findMany({
    where: { payroll: { documentId } },
    orderBy: [{ lineNo: 'asc' }],
    include: { customIncome: true, customDeduction: true },
  });
  return lines.map((l) => ({
    employeeName: l.employeeName,
    netPaid: money(l.netPaid),
    systemPulledAt: l.systemPulledAt,
    income: l.customIncome
      .map((i) => ({ source: i.source, accountCode: i.accountCode, name: i.name, amount: money(i.amount), quantity: i.quantity == null ? null : i.quantity.toFixed(1) }))
      .sort((a, b) => `${a.source}|${a.name}`.localeCompare(`${b.source}|${b.name}`)),
    deduction: l.customDeduction.map((d) => ({ accountCode: d.accountCode, name: d.name, amount: money(d.amount) })),
  }));
}

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  await roles.onModuleInit();
  // JournalAutoService ลงรายการในชื่อผู้ใช้ระบบ admin@bestchoice.com — ฐานทดสอบมีแต่ migrations ⇒ upsert เอง
  // (pattern payroll-shop-flow.integration.spec.ts) และใช้เป็นเจ้าของที่ทำ/อนุมัติใบในสเปกนี้ (ไม่ลบตอนจบ)
  ownerId = (
    await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' },
      create: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER', isActive: true },
      update: {},
      select: { id: true },
    })
  ).id;
  await setConfig('approval_enabled', 'true');
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow(SAVED);
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await setConfig('approval_enabled', null);
  await setConfig('auto_post_on_approve', null);
  const docs = await prisma.expenseDocument.findMany({ where: { branchId: { in: branchIds } }, select: { id: true, journalEntryId: true } });
  const jeIds = docs.flatMap((d) => (d.journalEntryId ? [d.journalEntryId] : []));
  if (jeIds.length > 0) {
    await prisma.expenseDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { journalEntryId: null } });
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
  }
  if (docs.length > 0) await prisma.expenseDocument.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } }); // cascade → details → lines → rows
  await prisma.attendancePunch.deleteMany({ where: { deviceId: { in: deviceIds } } });
  await prisma.attendanceDevice.deleteMany({ where: { id: { in: deviceIds } } });
  await prisma.attendanceCorrection.deleteMany({ where: { day: { userId: { in: userIds } } } });
  await prisma.attendanceDay.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
  // แถว AuditLog ลบไม่ได้ (trigger) ⇒ ผู้ใช้ที่มีแถว audit คงไว้ในฐานชั่วคราว แต่ปลดสาขาก่อนลบสาขา
  const audited = new Set((await prisma.auditLog.findMany({ where: { userId: { in: userIds } }, select: { userId: true } })).map((r) => r.userId));
  await prisma.user.updateMany({ where: { id: { in: [...audited].filter((id): id is string => !!id) } }, data: { branchId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds.filter((id) => !audited.has(id)) } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.$disconnect();
}, 120_000);

describe('Payroll submit / approve / post gate (Postgres)', () => {
  it('submit at 17:59 on 1 Nov → 409 PAYROLL_SUBMIT_CUTOFF (also an all-DAILY payroll) · the draft is untouched · a free-text-only payroll is not gated', async () => {
    setNow(SAVED);
    const b = await mkBranch('cutoff');
    const u = await mkUser('cutoff', b);
    await otDay(u, b, 1);
    const daily = await mkUser('cutoff-daily', b, { profile: { employmentType: 'DAILY', baseSalary: null } });
    const linked = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
    const b2 = await mkBranch('cutoff-daily');
    const allDaily = await createDoc(b2, [{ userId: daily, baseSalary: 9000 }]);
    const b3 = await mkBranch('cutoff-free');
    const freeText = await createDoc(b3, [{ employeeName: 'ลูกจ้าง ไม่ผูกทะเบียน', baseSalary: 9000 }]);
    const before = await storedRows(linked.id);

    setNow(BEFORE);
    for (const doc of [linked, allDaily]) {
      await expectConflict(lifecycle.submitForApproval(doc.id, ownerId), { code: 'PAYROLL_SUBMIT_CUTOFF', closableAt: CLOSABLE_AT, message: SUBMIT_CUTOFF });
      expect(await statusOf(doc.id)).toBe('DRAFT');
      expect(await prisma.auditLog.count({ where: { action: 'APPROVAL_REQUESTED', entityId: doc.id } })).toBe(0);
    }
    expect(await storedRows(linked.id)).toEqual(before);

    await lifecycle.submitForApproval(freeText.id, ownerId);
    expect(await statusOf(freeText.id)).toBe('PENDING_APPROVAL');
  });

  it('submit at 18:01 recomputes and re-stores the rows (a punch added after the save appears) · manual, adjustment, deduction rows and the free-text line are kept', async () => {
    setNow(SAVED);
    const b = await mkBranch('refresh');
    const u = await mkUser('refresh', b);
    await otDay(u, b, 1);
    const doc = await createDoc(b, [
      {
        userId: u,
        baseSalary: 16500,
        customIncome: [
          { accountCode: 'S52-1204', name: 'โบนัส', amount: 1000 },
          { accountCode: 'S52-1202', name: 'OT เดือนก่อน', amount: 200, isAdjustment: true },
        ],
        customDeduction: [{ accountCode: 'S21-1103', name: 'หักคืนเงินยืม', amount: 500 }],
      },
      { employeeName: 'ลูกจ้าง ไม่ผูกทะเบียน', baseSalary: 9000 },
    ]);
    expect((await storedRows(doc.id))[0].income).toContainEqual({ source: 'ATTENDANCE_OT', accountCode: 'S52-1202', name: OT_LABEL, amount: '154.69', quantity: '1.5' });

    await mkDay(u, b, 2, { in: '10:00', out: '21:00', ot: 2 }); // ตอกหลังบันทึกร่าง → รวม 3.5 ชม.
    setNow(AFTER);
    const submitted = await lifecycle.submitForApproval(doc.id, ownerId);
    expect(submitted.status).toBe('PENDING_APPROVAL');

    const [linked, free] = await storedRows(doc.id);
    expect(linked.income).toEqual([
      { source: 'ADJUSTMENT', accountCode: 'S52-1202', name: 'OT เดือนก่อน', amount: '200.00', quantity: null },
      { source: 'ATTENDANCE_OT', accountCode: 'S52-1202', name: OT_LABEL, amount: '360.94', quantity: '3.5' },
      { source: 'MANUAL', accountCode: 'S52-1204', name: 'โบนัส', amount: '1000.00', quantity: null },
    ]);
    expect(linked.deduction).toEqual([{ accountCode: 'S21-1103', name: 'หักคืนเงินยืม', amount: '500.00' }]);
    expect(linked.netPaid).toBe('17560.94'); // 16,500 + 1,000 + 200 + 360.94 − 500
    expect(linked.systemPulledAt?.toISOString()).toBe(bkk(AFTER).toISOString());
    expect(free).toMatchObject({ employeeName: 'ลูกจ้าง ไม่ผูกทะเบียน', netPaid: '9000.00', income: [], systemPulledAt: null });

    const stored = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(money(stored.totalAmount)).toBe('27060.94');
    expect(money(stored.netPayment)).toBe('26560.94');
    const requested = await prisma.auditLog.findFirstOrThrow({ where: { action: 'APPROVAL_REQUESTED', entityId: doc.id } });
    expect(requested.newValue).toMatchObject({ status: 'PENDING_APPROVAL', totalAmount: '27060.94' });
    expect(await prisma.auditLog.count({ where: { action: 'SENT_BACK_TO_DRAFT', entityId: doc.id } })).toBe(0);
  });

  it('R20 FX1: no attendance rows this month → typed OT is accepted as MANUAL (NO_PIN / NO_ATTENDANCE) · rows that appear before submit make the submit refresh refuse MANUAL_OT_DUPLICATE (draft untouched) · rows that appear after submit make approve stale and the re-save refuses', async () => {
    const typedOt = { accountCode: 'S52-1202', name: 'OT กรอกเอง', amount: 500 };
    const manualOnly = [{ source: 'MANUAL', accountCode: 'S52-1202', name: 'OT กรอกเอง', amount: '500.00', quantity: null }];
    const duplicate = (name: string) => ({
      code: 'MANUAL_OT_DUPLICATE',
      message: `${name} มีแถว OT ที่กรอกเองซ้ำกับ OT จากระบบลงเวลา — ลบแถวนั้น หรือติ๊ก "รายการปรับปรุงงวดก่อน" ถ้าเป็นการแก้ OT ของเดือนก่อน`,
    });
    const expect400 = async (p: Promise<unknown>, body: Record<string, unknown>) => {
      const err = await p.then(
        () => { throw new Error('expected a 400'); },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toEqual(body);
    };
    const notesOf = async (documentId: string) =>
      (await prisma.payrollLine.findMany({ where: { payroll: { documentId } }, orderBy: { lineNo: 'asc' }, select: { attendanceSummary: true, systemNotes: true } })).map((l) => ({
        tracked: (l.attendanceSummary as { attendanceTracked?: boolean } | null)?.attendanceTracked,
        warnings: (l.systemNotes as { warnings: unknown[] } | null)?.warnings,
      }));

    // (ก) ไม่มีรหัสตอกบัตร + สาขาไม่มีเครื่อง (มีรหัสแต่ไม่มีแถวลงเวลาเลย) — รายเดือน มีเงินเดือนทะเบียน
    setNow(SAVED);
    const b = await mkBranch('untracked');
    const noPin = await mkUser('no-pin', b, { pin: false });
    const noDevice = await mkUser('no-device', b);
    const doc = await createDoc(b, [
      { userId: noPin, baseSalary: 16500, customIncome: [typedOt] },
      { userId: noDevice, baseSalary: 16500, customIncome: [typedOt] },
    ]);
    const saved = await storedRows(doc.id);
    expect(saved.map((l) => [l.income, l.netPaid])).toEqual([
      [manualOnly, '17000.00'],
      [manualOnly, '17000.00'],
    ]);
    expect(await notesOf(doc.id)).toEqual([
      { tracked: false, warnings: [{ code: 'NO_PIN' }, { code: 'NOT_YET_CLOSABLE', closableAt: CLOSABLE_AT }] },
      { tracked: false, warnings: [{ code: 'NO_ATTENDANCE' }, { code: 'NOT_YET_CLOSABLE', closableAt: CLOSABLE_AT }] },
    ]);

    // ตอกบัตรเข้ามาทีหลัง (ก่อนส่ง) → ตอนส่งคิดใหม่แล้วกติกาแถวซ้ำกลับมาใช้ ⇒ 400 ภาษาไทยพร้อมชื่อ (ไม่ใช่ 500) · ร่างไม่ถูกแตะ
    await otDay(noDevice, b, 20);
    setNow(AFTER);
    await expect400(lifecycle.submitForApproval(doc.id, ownerId), duplicate('พนักงาน no-device'));
    expect(await statusOf(doc.id)).toBe('DRAFT');
    expect(await storedRows(doc.id)).toEqual(saved);
    expect(await prisma.auditLog.count({ where: { action: 'APPROVAL_REQUESTED', entityId: doc.id } })).toBe(0);

    // (ข) ส่งขออนุมัติตอนยังไม่มีแถวลงเวลา → แถวลงเวลาโผล่หลังส่ง → อนุมัติชนยอดเปลี่ยน (ไม่มี JE) → กดแก้ไขแล้วบันทึก = 400 แถวซ้ำ
    setNow(SAVED);
    const b2 = await mkBranch('untracked-later');
    const late = await mkUser('late', b2);
    const doc2 = await createDoc(b2, [{ userId: late, baseSalary: 16500, customIncome: [typedOt] }]);
    setNow(AFTER);
    await lifecycle.submitForApproval(doc2.id, ownerId);
    expect(await statusOf(doc2.id)).toBe('PENDING_APPROVAL');
    expect((await storedRows(doc2.id))[0].income).toEqual(manualOnly);

    await otDay(late, b2, 21);
    await expectConflict(approveAsSeen(doc2.id), {
      code: 'PAYROLL_STALE',
      diffs: [{ userId: late, employeeName: 'พนักงาน late', label: OT_LABEL, stored: { amount: '0.00', hours: null }, current: { amount: '154.69', hours: '1.5' } }],
      message: STALE,
    });
    const held = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc2.id } });
    expect(held.status).toBe('PENDING_APPROVAL');
    expect(held.journalEntryId).toBeNull();
    await expect400(
      creator.updatePayroll(
        doc2.id,
        { documentDate: '2026-10-31', payrollPeriod: PERIOD, entityScope: 'SHOP', depositAccountCode: 'S11-1202', paymentMethod: 'BANK_TRANSFER', lines: [{ userId: late, baseSalary: 16500, customIncome: [typedOt] }] } as never,
        OWNER(),
      ),
      duplicate('พนักงาน late'),
    );
    expect(await statusOf(doc2.id)).toBe('PENDING_APPROVAL');
  });

  it('approval_enabled = false: post() of a DRAFT before the cutoff → 409 PAYROLL_CUTOFF (stays DRAFT, no JE) · at 18:01 it posts with the OT row', async () => {
    setNow(SAVED);
    await setConfig('approval_enabled', 'false');
    try {
      const b = await mkBranch('post-cutoff');
      const u = await mkUser('post-cutoff', b);
      await otDay(u, b, 4);
      const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);

      setNow(BEFORE);
      await expectConflict(postAsSeen(doc.id), { code: 'PAYROLL_CUTOFF', closableAt: CLOSABLE_AT, message: POST_CUTOFF });
      const after = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(after.status).toBe('DRAFT');
      expect(after.journalEntryId).toBeNull();

      setNow(AFTER);
      await postAsSeen(doc.id);
      const posted = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(posted.status).toBe('POSTED');
      const lines = await prisma.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! } });
      expect(money(lines.find((l) => l.accountCode === 'S52-1202')?.debit)).toBe('154.69');
    } finally {
      await setConfig('approval_enabled', 'true');
    }
  });

  it('a DEVICE_CONFLICT day of any linked employee → approve 409 listing the days (submit still allowed) · the document stays PENDING_APPROVAL · after the owner clears the flags it posts', async () => {
    setNow(SAVED);
    const b = await mkBranch('conflict');
    const u = await mkUser('dc', b);
    const daily = await mkUser('dc-daily', b, { profile: { employmentType: 'DAILY', baseSalary: null } });
    const d1 = await otDay(u, b, 15, ['DEVICE_CONFLICT']);
    const d2 = await mkDay(daily, b, 16, { in: '10:00', out: '19:00', flags: ['DEVICE_CONFLICT', 'NO_PHOTO'] });
    const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }, { userId: daily, baseSalary: 9000 }]);

    setNow(AFTER);
    await lifecycle.submitForApproval(doc.id, ownerId);
    expect(await statusOf(doc.id)).toBe('PENDING_APPROVAL');
    await expectConflict(approveAsSeen(doc.id), {
      code: 'PAYROLL_DEVICE_CONFLICT',
      days: [
        { dayId: d1.id, userId: u, employeeName: 'พนักงาน dc', date: '2026-10-15', branchId: b },
        { dayId: d2.id, userId: daily, employeeName: 'พนักงาน dc-daily', date: '2026-10-16', branchId: b },
      ],
      message: 'อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน 2 วัน (พนักงาน dc · 15 ต.ค., พนักงาน dc-daily · 16 ต.ค.) ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วกด "ตรวจแล้ว ล้างธง"',
    });
    const held = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(held.status).toBe('PENDING_APPROVAL');
    expect(held.approvedById).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'APPROVED', entityId: doc.id } })).toBe(0);

    await attendance.clearConflictFlag({ id: ownerId, role: 'OWNER', branchId: null }, d1.id);
    await attendance.clearConflictFlag({ id: ownerId, role: 'OWNER', branchId: null }, d2.id);
    await approveAsSeen(doc.id);
    expect(await statusOf(doc.id)).toBe('POSTED');
  });

  it('a manager correction after submit → approve 409 PAYROLL_STALE with the diff (hours 1.5 → 2.5 · 154.69 → 257.81) · stays PENDING_APPROVAL', async () => {
    setNow(SAVED);
    const b = await mkBranch('stale');
    const u = await mkUser('stale', b);
    const bm = await mkUser('stale-bm', b, { role: 'BRANCH_MANAGER', profile: null });
    const corrected = await otDay(u, b, 3);
    const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
    setNow(AFTER);
    await lifecycle.submitForApproval(doc.id, ownerId);

    await attendance.correctDay({ id: bm, role: 'BRANCH_MANAGER', branchId: b }, corrected.id, { clockOut: atDay(3, '21:30').toISOString(), reason: 'ลืมตอกออก แก้ตามกล้องวงจรปิด' } as never);
    await expectConflict(approveAsSeen(doc.id), {
      code: 'PAYROLL_STALE',
      diffs: [{ userId: u, employeeName: 'พนักงาน stale', label: OT_LABEL, stored: { amount: '154.69', hours: '1.5' }, current: { amount: '257.81', hours: '2.5' } }],
      message: STALE,
    });
    expect(await statusOf(doc.id)).toBe('PENDING_APPROVAL');
  });

  it('registry salary / employment type changed between submit and approve → stale (same hours, different amounts · row gone)', async () => {
    setNow(SAVED);
    const b = await mkBranch('registry');
    const raised = await mkUser('raised', b);
    const toDaily = await mkUser('to-daily', b);
    await otDay(raised, b, 6);
    await otDay(toDaily, b, 6);
    const doc = await createDoc(b, [{ userId: raised, baseSalary: 16500 }, { userId: toDaily, baseSalary: 16500 }]);
    setNow(AFTER);
    await lifecycle.submitForApproval(doc.id, ownerId);

    await prisma.employeeProfile.update({ where: { userId: raised }, data: { baseSalary: 18000 } });
    await prisma.employeeProfile.update({ where: { userId: toDaily }, data: { employmentType: 'DAILY' } });
    await expectConflict(approveAsSeen(doc.id), {
      code: 'PAYROLL_STALE',
      diffs: [
        { userId: raised, employeeName: 'พนักงาน raised', label: OT_LABEL, stored: { amount: '154.69', hours: '1.5' }, current: { amount: '168.75', hours: '1.5' } },
        { userId: toDaily, employeeName: 'พนักงาน to-daily', label: OT_LABEL, stored: { amount: '154.69', hours: '1.5' }, current: { amount: '0.00', hours: null } },
      ],
      message: STALE,
    });
  });

  it('a kiosk OUT at 01:30 on 1 Nov lands on the 31 Oct row before the cutoff — a submit at 17:59 is refused, at 18:01 it carries the OUT and the approve posts (no stale)', async () => {
    const b = await mkBranch('kiosk');
    const u = await mkUser('kiosk', b);
    const device = await prisma.attendanceDevice.create({ data: { branchId: b, name: `แท็บเล็ต ${stamp}`, registeredById: ownerId } });
    deviceIds.push(device.id);
    const input = (kind: 'IN' | 'OUT') => ({ device: { id: device.id, branchId: b, name: device.name, lastIp: null }, userId: u, kind });

    await kiosk.punch(input('IN'), bkk('2026-10-31 19:00'));
    setNow('2026-10-31 19:05');
    const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
    expect((await storedRows(doc.id))[0].income).toEqual([]); // ยังไม่ออกงาน = ยังไม่มี OT

    await kiosk.punch(input('OUT'), bkk('2026-11-01 01:30'));
    const oct31 = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: u } });
    expect(oct31.workDate.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(oct31.clockOut?.toISOString()).toBe(bkk('2026-11-01 01:30').toISOString());

    setNow(BEFORE);
    await expectConflict(lifecycle.submitForApproval(doc.id, ownerId), { code: 'PAYROLL_SUBMIT_CUTOFF', closableAt: CLOSABLE_AT, message: SUBMIT_CUTOFF });
    setNow(AFTER);
    await lifecycle.submitForApproval(doc.id, ownerId);
    expect((await storedRows(doc.id))[0].income).toEqual([{ source: 'ATTENDANCE_OT', accountCode: 'S52-1202', name: OT_LABEL, amount: '670.31', quantity: '6.5' }]);

    await approveAsSeen(doc.id);
    const posted = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(posted.status).toBe('POSTED');
    const lines = await prisma.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! } });
    expect(money(lines.find((l) => l.accountCode === 'S52-1202')?.debit)).toBe('670.31');
  });

  it('auto-post off: approve is still gated before the flip · approve OK → APPROVED · a correction then makes post() refuse as stale (stays APPROVED, no JE)', async () => {
    setNow(SAVED);
    await setConfig('auto_post_on_approve', 'false');
    try {
      const b = await mkBranch('manual-post');
      const u = await mkUser('manual-post', b);
      const bm = await mkUser('manual-post-bm', b, { role: 'BRANCH_MANAGER', profile: null });
      const otRow = await otDay(u, b, 5);
      const flagged = await mkDay(u, b, 6, { in: '10:00', out: '19:00', flags: ['DEVICE_CONFLICT'] });
      const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
      setNow(AFTER);
      await lifecycle.submitForApproval(doc.id, ownerId);

      await expectConflict(approveAsSeen(doc.id), {
        code: 'PAYROLL_DEVICE_CONFLICT',
        days: [{ dayId: flagged.id, userId: u, employeeName: 'พนักงาน manual-post', date: '2026-10-06', branchId: b }],
        message: 'อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน 1 วัน (พนักงาน manual-post · 6 ต.ค.) ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วกด "ตรวจแล้ว ล้างธง"',
      });
      expect(await statusOf(doc.id)).toBe('PENDING_APPROVAL');

      await attendance.clearConflictFlag({ id: ownerId, role: 'OWNER', branchId: null }, flagged.id);
      await approveAsSeen(doc.id);
      const approved = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(approved.status).toBe('APPROVED');
      expect(approved.approvedById).toBe(ownerId);
      expect(approved.journalEntryId).toBeNull();

      await attendance.correctDay({ id: bm, role: 'BRANCH_MANAGER', branchId: b }, otRow.id, { clockOut: atDay(5, '21:30').toISOString(), reason: 'ลืมตอกออก แก้ตามกล้องวงจรปิด' } as never);
      await expectConflict(postAsSeen(doc.id), {
        code: 'PAYROLL_STALE',
        diffs: [{ userId: u, employeeName: 'พนักงาน manual-post', label: OT_LABEL, stored: { amount: '154.69', hours: '1.5' }, current: { amount: '257.81', hours: '2.5' } }],
        message: STALE,
      });
      const still = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(still.status).toBe('APPROVED');
      expect(still.journalEntryId).toBeNull();
    } finally {
      await setConfig('auto_post_on_approve', null);
    }
  });

  it('one person, two branches, one month: the document saved second holds no OT and cannot post (PAYROLL_OTHER_DOC) · a third document that also holds the rows blocks the first · the first posts once it is gone', async () => {
    setNow(SAVED);
    const bA = await mkBranch('two-a');
    const bB = await mkBranch('two-b');
    const bC = await mkBranch('two-c');
    const u = await mkUser('two', bA);
    await otDay(u, bA, 7);
    const first = await createDoc(bA, [{ userId: u, baseSalary: 16500 }]);
    const second = await createDoc(bB, [{ userId: u, baseSalary: 16500 }]);
    expect((await storedRows(first.id))[0].income).toHaveLength(1);
    expect((await storedRows(second.id))[0].income).toEqual([]);

    setNow(AFTER);
    await lifecycle.submitForApproval(first.id, ownerId);
    await lifecycle.submitForApproval(second.id, ownerId);
    const otherDoc = (number: string) => ({ code: 'PAYROLL_OTHER_DOC', documentNumber: number, message: `OT ของ พนักงาน two เดือนนี้อยู่ในใบ ${number} แล้ว — เอาออกจากใบใดใบหนึ่งก่อน` });
    await expectConflict(approveAsSeen(second.id), otherDoc(first.number));

    // ใบที่สามถือแถวลงเวลาของคนเดียวกันด้วย (ข้อมูลที่ไม่ได้มาจากทางบันทึก) — ด่านบอก "ใบอื่น" ไม่ใช่ "ยอดเปลี่ยน"
    const third = await prisma.expenseDocument.create({
      data: {
        number: `PR-GATE-SEED-${stamp}`,
        documentType: 'PAYROLL',
        branchId: bC,
        documentDate: new Date('2026-10-31T00:00:00.000Z'),
        subtotal: 16500,
        vatAmount: 0,
        withholdingTax: 0,
        totalAmount: 16654.69,
        netPayment: 16654.69,
        depositAccountCode: 'S11-1202',
        status: 'DRAFT',
        createdById: ownerId,
        payroll: {
          create: {
            payrollPeriod: PERIOD,
            entityScope: 'SHOP',
            lines: {
              create: [{
                userId: u,
                employeeName: 'พนักงาน two',
                baseSalary: 16500,
                netPaid: 16654.69,
                lineNo: 1,
                systemPulledAt: bkk(SAVED),
                customIncome: { create: [{ accountCode: 'S52-1202', name: OT_LABEL, amount: 154.69, source: 'ATTENDANCE_OT', quantity: 1.5, rate: 103.125, multiplier: 1.5 }] },
              }],
            },
          },
        },
      },
    });
    await expectConflict(approveAsSeen(first.id), otherDoc(third.number));

    await prisma.expenseDocument.update({ where: { id: third.id }, data: { status: 'VOIDED' } });
    await approveAsSeen(first.id);
    expect(await statusOf(first.id)).toBe('POSTED');
    await expectConflict(approveAsSeen(second.id), otherDoc(first.number));
    expect(await statusOf(second.id)).toBe('PENDING_APPROVAL');
  });

  it('findOne exposes payrollGate (closableAt until the cutoff · device-conflict days) · a free-text payroll has no gate · null when the gate is not wired', async () => {
    setNow(SAVED);
    const b = await mkBranch('inspect');
    const u = await mkUser('inspect', b);
    const flagged = await mkDay(u, b, 20, { in: '10:00', out: '19:00', flags: ['DEVICE_CONFLICT'] });
    const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
    const b2 = await mkBranch('inspect-free');
    const freeText = await createDoc(b2, [{ employeeName: 'ลูกจ้าง ไม่ผูกทะเบียน', baseSalary: 9000 }]);
    const conflicts = [{ dayId: flagged.id, userId: u, employeeName: 'พนักงาน inspect', date: '2026-10-20', branchId: b }];
    const gateOf = async (q: ExpenseDocumentQueryService, id: string) => ((await q.findOne(id, 'OWNER', null)) as unknown as { payrollGate: unknown }).payrollGate;

    setNow(BEFORE);
    expect(await gateOf(query, doc.id)).toEqual({ closableAt: CLOSABLE_AT, deviceConflicts: conflicts });
    setNow(AFTER);
    expect(await gateOf(query, doc.id)).toEqual({ closableAt: null, deviceConflicts: conflicts });
    expect(await gateOf(query, freeText.id)).toEqual({ closableAt: null, deviceConflicts: [] });
    expect(await gateOf(new ExpenseDocumentQueryService(prisma as never, undefined as never), doc.id)).toBeNull();

    // R10 — ใบที่ลงบัญชี/ยกเลิกแล้วไม่มีด่านให้แสดง (วันติดธงของใบนี้ยังอยู่ — ถ้ายังเรียก inspect จะได้รายการวัน)
    const inspect = vi.spyOn(gate, 'inspect');
    try {
      for (const status of ['POSTED', 'VOIDED'] as const) {
        await prisma.expenseDocument.update({ where: { id: doc.id }, data: { status } });
        expect(await gateOf(query, doc.id)).toBeNull();
      }
      expect(inspect).not.toHaveBeenCalled();
      await prisma.expenseDocument.update({ where: { id: doc.id }, data: { status: 'APPROVED' } });
      expect(await gateOf(query, doc.id)).toEqual({ closableAt: null, deviceConflicts: conflicts });
      expect(inspect).toHaveBeenCalledTimes(1);
    } finally {
      inspect.mockRestore();
    }
  });

  it('a branch manager submits an owner-made payroll that carries another branch\'s employee (no NOT_IN_BRANCH on the refresh) · a BM PATCH adding such an employee is still refused', async () => {
    setNow(SAVED);
    const b = await mkBranch('bm-submit');
    const other = await mkBranch('bm-submit-other');
    const bm = await mkUser('bm-submit-actor', b, { role: 'BRANCH_MANAGER', profile: null });
    const insider = await mkUser('bm-insider', b);
    const outsider = await mkUser('bm-outsider', other);
    const outsider2 = await mkUser('bm-outsider-2', other);
    await otDay(outsider, other, 8);
    const doc = await createDoc(b, [{ userId: insider, baseSalary: 16500 }, { userId: outsider, baseSalary: 16500 }]); // เจ้าของทำ

    setNow(AFTER);
    await lifecycle.submitForApproval(doc.id, bm);
    expect(await statusOf(doc.id)).toBe('PENDING_APPROVAL');
    const [, outsiderLine] = await storedRows(doc.id);
    expect(outsiderLine.income).toEqual([{ source: 'ATTENDANCE_OT', accountCode: 'S52-1202', name: OT_LABEL, amount: '154.69', quantity: '1.5' }]);
    expect(outsiderLine.systemPulledAt?.toISOString()).toBe(bkk(AFTER).toISOString()); // คิดใหม่ตอนส่งจริง

    const err = await creator
      .updatePayroll(
        doc.id,
        {
          documentDate: '2026-10-31',
          payrollPeriod: PERIOD,
          entityScope: 'SHOP',
          depositAccountCode: 'S11-1202',
          lines: [{ userId: insider, baseSalary: 16500 }, { userId: outsider, baseSalary: 16500 }, { userId: outsider2, baseSalary: 16500 }],
        } as never,
        { id: bm, branchId: b, role: 'BRANCH_MANAGER' },
      )
      .then(() => { throw new Error('expected NOT_IN_BRANCH'); }, (e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'NOT_IN_BRANCH', message: expect.stringContaining('พนักงาน bm-outsider-2') });
    expect(await statusOf(doc.id)).toBe('PENDING_APPROVAL'); // ไม่ถูกส่งกลับเป็นร่าง
  });

  it('R20 FX2: the approver loads a PENDING_APPROVAL payroll → the maker presses แก้ไข, edits and re-submits → approve with the version the approver saw = 409 DOCUMENT_CHANGED (stays PENDING_APPROVAL, no JE) · with the fresh version it posts the new figures', async () => {
    const changed = { code: 'DOCUMENT_CHANGED', message: 'ใบนี้ถูกแก้ไขหลังจากที่คุณเปิดดู — โหลดหน้านี้ใหม่ ตรวจยอดอีกครั้ง แล้วกด อนุมัติและลงบัญชี' };
    const rendered = async (id: string) => ((await query.findOne(id, 'OWNER', null)) as unknown as { updatedAt: Date }).updatedAt.toISOString();
    const at = (iso: string) => new Date(iso).getTime();
    setNow(SAVED);
    const b = await mkBranch('version');
    const u = await mkUser('version', b);
    await otDay(u, b, 8);
    const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
    setNow(AFTER);
    await lifecycle.submitForApproval(doc.id, ownerId);
    const seen = await rendered(doc.id); // หน้าของผู้อนุมัติวาดฉบับนี้ (GET /expense-documents/:id)

    // ผู้ทำเงินเดือนกด แก้ไข (PATCH ส่งกลับเป็นร่าง) เพิ่มโบนัส แล้วส่งใหม่ — ด่านใบเงินเดือนแยกไม่ออกเพราะการแก้เขียนแถวที่เก็บใหม่หมด
    await creator.updatePayroll(
      doc.id,
      { documentDate: '2026-10-31', payrollPeriod: PERIOD, entityScope: 'SHOP', depositAccountCode: 'S11-1202', paymentMethod: 'BANK_TRANSFER', lines: [{ userId: u, baseSalary: 16500, customIncome: [{ accountCode: 'S52-1204', name: 'โบนัส', amount: 2000 }] }] } as never,
      OWNER(),
    );
    const afterPatch = await versionOf(doc.id);
    expect(await statusOf(doc.id)).toBe('DRAFT');
    expect(at(afterPatch)).toBeGreaterThan(at(seen)); // PATCH ขยับ updatedAt
    await lifecycle.submitForApproval(doc.id, ownerId);
    const afterResubmit = await versionOf(doc.id);
    expect(await statusOf(doc.id)).toBe('PENDING_APPROVAL');
    expect(at(afterResubmit)).toBeGreaterThan(at(afterPatch)); // ตอนส่ง (คิดใหม่ + เปลี่ยนสถานะ) ขยับอีก

    await expectConflict(lifecycle.approve(doc.id, ownerId, 'OWNER', { expectedUpdatedAt: seen }), changed);
    await expectConflict(lifecycle.approve(doc.id, ownerId, 'OWNER'), changed); // ไม่ส่งฉบับมาเลย = ปฏิเสธเหมือนกัน
    const held = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(held.status).toBe('PENDING_APPROVAL');
    expect(held.approvedById).toBeNull();
    expect(held.journalEntryId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'APPROVED', entityId: doc.id } })).toBe(0);

    const fresh = await rendered(doc.id);
    expect(fresh).toBe(afterResubmit);
    await lifecycle.approve(doc.id, ownerId, 'OWNER', { expectedUpdatedAt: fresh });
    const posted = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(posted.status).toBe('POSTED');
    const lines = await prisma.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! } });
    expect(money(lines.find((l) => l.accountCode === 'S52-1204')?.debit)).toBe('2000.00');
    expect(money(lines.find((l) => l.accountCode === 'S52-1202')?.debit)).toBe('154.69');
  });

  it('R20 FX2: auto-post off — the APPROVED flip moves updatedAt, so post() with the pre-approval version = 409 DOCUMENT_CHANGED (บันทึกและลงบัญชี, no JE) · with the APPROVED version it posts', async () => {
    setNow(SAVED);
    await setConfig('auto_post_on_approve', 'false');
    try {
      const b = await mkBranch('version-post');
      const u = await mkUser('version-post', b);
      await otDay(u, b, 9);
      const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
      setNow(AFTER);
      await lifecycle.submitForApproval(doc.id, ownerId);
      const pending = await versionOf(doc.id);
      await lifecycle.approve(doc.id, ownerId, 'OWNER', { expectedUpdatedAt: pending });
      const approved = await versionOf(doc.id);
      expect(await statusOf(doc.id)).toBe('APPROVED');
      expect(new Date(approved).getTime()).toBeGreaterThan(new Date(pending).getTime());

      await expectConflict(lifecycle.post(doc.id, ownerId, undefined, { expectedUpdatedAt: pending }), {
        code: 'DOCUMENT_CHANGED',
        message: 'ใบนี้ถูกแก้ไขหลังจากที่คุณเปิดดู — โหลดหน้านี้ใหม่ ตรวจยอดอีกครั้ง แล้วกด บันทึกและลงบัญชี',
      });
      const still = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(still.status).toBe('APPROVED');
      expect(still.journalEntryId).toBeNull();

      await lifecycle.post(doc.id, ownerId, undefined, { expectedUpdatedAt: approved });
      expect(await statusOf(doc.id)).toBe('POSTED');
    } finally {
      await setConfig('auto_post_on_approve', null);
    }
  });

  // คำตัดสินเจ้าของ 2026-10-28 — วันที่จ่ายเงิน = วันที่กดลงบัญชี (แก้ได้ก่อนกด) · เดิมใช้วันที่สร้างร่าง
  describe('payment date = the day it is posted', () => {
    const bkkYmd = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const jeDateOf = async (id: string) => {
      const d = await prisma.expenseDocument.findUniqueOrThrow({ where: { id }, select: { documentDate: true, journalEntryId: true } });
      const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: d.journalEntryId! }, select: { postedAt: true, entryDate: true } });
      return { doc: d.documentDate.toISOString().slice(0, 10), je: (je.postedAt ?? je.entryDate).toISOString() };
    };

    it('approve (auto-post) without a date stamps today (Bangkok) on the document instead of the draft date', async () => {
      setNow(SAVED);
      const b = await mkBranch('paydate-today');
      const u = await mkUser('paydate-today', b);
      const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]); // ร่างวันที่ 2026-10-31
      setNow(AFTER);
      await lifecycle.submitForApproval(doc.id, ownerId);
      await approveAsSeen(doc.id);
      expect(await statusOf(doc.id)).toBe('POSTED');
      const dates = await jeDateOf(doc.id);
      expect(dates.doc).toBe(bkkYmd());
      expect(dates.doc).not.toBe('2026-10-31');
      expect(dates.je.slice(0, 10)).toBe(dates.doc); // รายการบัญชีลงวันที่จ่ายเดียวกัน (postedAt = documentDate)
    });

    it('a chosen past date is used for the document and its journal entry', async () => {
      setNow(SAVED);
      const b = await mkBranch('paydate-chosen');
      const u = await mkUser('paydate-chosen', b);
      const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
      setNow(AFTER);
      await lifecycle.submitForApproval(doc.id, ownerId);
      const chosen = bkkYmd();
      await lifecycle.approve(doc.id, ownerId, 'OWNER', { expectedUpdatedAt: await versionOf(doc.id), paymentDate: chosen });
      expect((await jeDateOf(doc.id)).doc).toBe(chosen);
    });

    it('a date after today is refused (400) and nothing is posted', async () => {
      setNow(SAVED);
      const b = await mkBranch('paydate-future');
      const u = await mkUser('paydate-future', b);
      const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
      setNow(AFTER);
      await lifecycle.submitForApproval(doc.id, ownerId);
      await expect(
        lifecycle.approve(doc.id, ownerId, 'OWNER', { expectedUpdatedAt: await versionOf(doc.id), paymentDate: '2099-01-01' }),
      ).rejects.toThrow('วันที่จ่ายเงินต้องไม่เกินวันนี้');
      expect(await statusOf(doc.id)).toBe('PENDING_APPROVAL');
    });
  });

  it('fail closed: without the gate / save path wired, submit, approve and post of a payroll with linked lines throw · a free-text payroll still flows', async () => {
    setNow(SAVED);
    const b = await mkBranch('unwired');
    const u = await mkUser('unwired', b);
    const doc = await createDoc(b, [{ userId: u, baseSalary: 16500 }]);
    const b2 = await mkBranch('unwired-free');
    const freeText = await createDoc(b2, [{ employeeName: 'ลูกจ้าง ไม่ผูกทะเบียน', baseSalary: 9000 }]);
    setNow(AFTER);
    const bare = buildLifecycle({});
    const gateOnly = buildLifecycle({ gate });

    await expect(bare.submitForApproval(doc.id, ownerId)).rejects.toThrow('PayrollSystemRowsService not wired');
    await expect(gateOnly.submitForApproval(doc.id, ownerId)).rejects.toThrow('PayrollSystemRowsService not wired');
    await prisma.expenseDocument.update({ where: { id: doc.id }, data: { status: 'PENDING_APPROVAL' } });
    await expect(approveAsSeen(doc.id, bare)).rejects.toThrow('PayrollSystemRowsService not wired');
    await setConfig('approval_enabled', 'false');
    try {
      await prisma.expenseDocument.update({ where: { id: doc.id }, data: { status: 'DRAFT' } });
      await expect(postAsSeen(doc.id, bare)).rejects.toThrow('PayrollSystemRowsService not wired');
      expect(await statusOf(doc.id)).toBe('DRAFT');
    } finally {
      await setConfig('approval_enabled', 'true');
    }

    await bare.submitForApproval(freeText.id, ownerId);
    expect(await statusOf(freeText.id)).toBe('PENDING_APPROVAL');
  });
});

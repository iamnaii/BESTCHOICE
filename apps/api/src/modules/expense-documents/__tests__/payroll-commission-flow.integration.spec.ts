import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { AuditService } from '../../audit/audit.service';
import { AttendanceSettingsService } from '../../attendance/attendance-settings.service';
import { bangkokMidnight } from '../../../utils/date.util';
import { SsoConfigService } from '../../sso-config/sso-config.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { AccountRoleService } from '../../journal/account-role.service';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';
import { CommissionService } from '../../commission/commission.service';
import { clawBackCommissions } from '../../commission/commission-clawback.util';
import { ExpenseDocumentCreateService } from '../services/expense-document-create.service';
import { ExpenseDocumentLifecycleService } from '../services/expense-document-lifecycle.service';
import { ExpenseDocumentQueryService } from '../services/expense-document-query.service';
import { LineAggregatorService } from '../services/line-aggregator.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { PayrollCustomService } from '../services/payroll-custom.service';
import { PettyCashService } from '../services/petty-cash.service';
import { PayrollSystemRowsService } from '../payroll-system/payroll-system-rows.service';
import { PayrollPostGateService } from '../payroll-system/payroll-post-gate.service';
import type { SystemNotes, SystemRowsQuery, SystemRowsResult } from '../payroll-system/payroll-system.types';

/**
 * Payroll D4 ส่วนที่ 2 · Task 4 — เก็บ / ด่าน / จ่าย / กลับรายการ ค่าคอมผ่านใบเงินเดือน (Postgres จริง · migrations อย่างเดียว ไม่มี seed)
 * - บันทึก: แถว COMMISSION + รายการ PAY · หักคืน (COMMISSION_CLAWBACK) + รายการ CLAWBACK · รายการหักที่ client ส่ง = MANUAL เสมอ ·
 *   CLAWBACK_DUPLICATE · P2002 ของดัชนีรายการ PAY → PAYROLL_COMMISSION_TAKEN
 * - ด่านอนุมัติ/ลงบัญชีเทียบแถวที่เก็บกับรายการที่ยังมีผล + สถานะค่าคอมปัจจุบัน (ไม่เทียบกับผล compute ⇒ ค่าคอมที่อนุมัติหลังส่งไม่ทำให้ stale)
 * - ลงบัญชี → ค่าคอมของรายการ PAY เป็น PAID (paidAt = วันที่เอกสาร, paidAmount = ยอดรายการ)
 * - กลับรายการ: ปฏิเสธเมื่อถูกหักคืนในใบที่ลงบัญชีแล้ว / ถูกเรียกคืนบางส่วน · ไม่งั้นคืนสถานะค่าคอมแล้วปล่อยรายการ · ลบร่างปล่อยรายการ
 * Review Focus 1–5 ของแผน (docs/superpowers/plans/2026-10-27-payroll-ot-part2-commission.md) อยู่ในชุดนี้ทั้งหมด
 * เวลาใช้ vi.useFakeTimers({ toFake: ['Date'] })
 * รัน: bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-commission-flow.integration.spec.ts
 */

const prisma = new PrismaClient();
const audit = new AuditService(prisma as never);
const settings = new AttendanceSettingsService(prisma as never);
const systemRows = new PayrollSystemRowsService(settings);
const gate = new PayrollPostGateService(systemRows);
const stamp = Date.now();
let seq = 0;
const docNumber = { next: async () => `PR-COMM-${stamp}-${String(++seq).padStart(3, '0')}` } as never;
const buildCreator = (rows: Pick<PayrollSystemRowsService, 'compute'>) =>
  new ExpenseDocumentCreateService(
    prisma as never,
    docNumber,
    new LineAggregatorService(),
    new StatusTransitionService(),
    new SsoConfigService(prisma as never),
    new PayrollCustomService(prisma as never),
    new PettyCashService(prisma as never),
    rows as PayrollSystemRowsService,
  );
const creator = buildCreator(systemRows);
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const roles = new AccountRoleService(prisma as never, audit);
const payrollTemplate = new PayrollTemplate(journal, prisma as never, roles, companyResolver);
const unexpected = () => ({ execute: async () => { throw new Error('only the payroll template runs in this spec'); } }) as never;
const lifecycle = new ExpenseDocumentLifecycleService(
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
  creator,
  gate,
);
const query = new ExpenseDocumentQueryService(prisma as never, undefined as never, gate);
const commissions = new CommissionService(prisma as never);

type Period = '2026-10' | '2026-11' | '2026-12';
const DOC_DATE: Record<Period, string> = { '2026-10': '2026-10-31', '2026-11': '2026-11-30', '2026-12': '2026-12-31' };
const SAVE_AT: Record<Period, string> = { '2026-10': '2026-10-31 20:00', '2026-11': '2026-11-30 20:00', '2026-12': '2026-12-31 20:00' };
const AFTER_CUTOFF: Record<Period, string> = { '2026-10': '2026-11-02 10:00', '2026-11': '2026-12-02 10:00', '2026-12': '2027-01-02 10:00' };
const COMMISSION_CODE = 'S51-1101';
const STALE =
  'ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลา/ค่าคอมเปลี่ยนหลังบันทึกใบ ให้ผู้ทำเงินเดือนกด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง';
const COMMISSION_TAKEN = 'ค่าคอมบางรายการอยู่ในใบเงินเดือนอื่นแล้ว — บันทึกใบอีกครั้งเพื่อให้ระบบคิดยอดใหม่';
const clawbackDuplicate = (name: string) => `${name} มีรายการหักบนบัญชีค่าคอมที่กรอกเองซ้ำกับหักคืนค่าคอมจากระบบ — ลบแถวนั้นออก`;
const voidAfterClawback = (documentNumber: string) =>
  `กลับรายการใบนี้ไม่ได้ — ค่าคอมที่ใบนี้จ่ายถูกหักคืนแล้วในใบ ${documentNumber} ให้กลับรายการใบนั้นก่อน`;
const voidPartialClawback = (reference: string) =>
  `กลับรายการใบนี้ไม่ได้ — ค่าคอม ${reference} ที่ใบนี้จ่ายถูกเรียกคืนบางส่วนแล้ว ถ้าต้องแก้ยอดของคนอื่นในใบนี้ ให้ใส่แถว "รายการปรับปรุงงวดก่อน" (จ่ายเพิ่ม) หรือรายการหัก (หักคืน) ในใบเงินเดือนงวดถัดไป`;
const COMMISSION_WARNINGS = new Set(['COMMISSION_IN_OTHER_DOCUMENT', 'CLAWBACK_CARRIED', 'CLAWBACK_PAID_OUTSIDE_PAYROLL']);
const VOID_DTO = { reasonCode: 'data_entry_error' };

const userIds: string[] = [];
const branchIds: string[] = [];
const commissionIds: string[] = [];
const contractIds: string[] = [];
const productIds: string[] = [];
const customerIds: string[] = [];
let ownerId: string;
const OWNER = () => ({ id: ownerId, branchId: null, role: 'OWNER' });

/** 'YYYY-MM-DD HH:mm' เวลาไทย */
const bkk = (s: string) => new Date(`${s.replace(' ', 'T')}:00+07:00`);
const setNow = (s: string) => vi.setSystemTime(bkk(s));
const money = (v: Prisma.Decimal | string | number | null | undefined) => (v == null ? null : new Prisma.Decimal(v.toString()).toFixed(2));

async function setConfig(key: string, value: string | null) {
  if (value === null) {
    await prisma.systemConfig.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemConfig.upsert({ where: { key }, update: { value, deletedAt: null }, create: { key, value } });
}

async function mkBranch(tag: string) {
  const b = await prisma.branch.create({ data: { name: `สาขา COMM-${tag} ${stamp}`, workStart: '10:00', workEnd: '19:00' }, select: { id: true } });
  branchIds.push(b.id);
  return b.id;
}

/** พนักงานขายรายเดือน (เงินเดือนทะเบียน 15,000 · มีรหัสตอกบัตร · ไม่มีแถวลงเวลา ⇒ ไม่มีแถว OT) */
async function mkUser(tag: string, branchId: string, o: { resignedDate?: Date } = {}) {
  const user = await prisma.user.create({
    data: { email: `comm-${tag}-${stamp}@test.local`, password: 'x', name: `พนักงาน ${tag}`, role: 'SALES', isActive: true, branchId, attendancePinHash: `pin-${tag}-${stamp}` },
  });
  userIds.push(user.id);
  await prisma.employeeProfile.create({ data: { userId: user.id, employmentType: 'MONTHLY', baseSalary: 15000, resignedDate: o.resignedDate ?? null } });
  return user.id;
}

/** สัญญาผ่อนขั้นต่ำ (ลูกค้า + เครื่อง) — ให้ applyClawbackForContract หาค่าคอมของสัญญาได้ · อ้างอิงของค่าคอม = เลขสัญญา */
async function mkContract(tag: string, branchId: string, salespersonId: string) {
  const customer = await prisma.customer.create({ data: { name: `ลูกค้า COMM-${tag} ${stamp}` } });
  customerIds.push(customer.id);
  const product = await prisma.product.create({
    data: { name: `เครื่อง ${tag}`, brand: 'TEST', model: `COMM-${tag}`, category: 'PHONE_NEW', costPrice: 10000, branchId, status: 'SOLD_INSTALLMENT' },
  });
  productIds.push(product.id);
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `CT-COMM-${tag}-${stamp}`,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      interestRate: 0.05,
      totalMonths: 12,
      interestTotal: 6000,
      financedAmount: 10000,
      monthlyPayment: 1515.83,
    },
  });
  contractIds.push(contract.id);
  return contract;
}

async function mkCommission(salespersonId: string, o: { period?: Period; amount?: number; contractId?: string } = {}) {
  const c = await prisma.salesCommission.create({
    data: {
      salespersonId,
      snapshotSalespersonId: salespersonId,
      contractId: o.contractId ?? null,
      period: o.period ?? '2026-10',
      saleAmount: 20000,
      commissionRate: 0.05,
      commissionAmount: o.amount ?? 1000,
      status: 'APPROVED',
    },
  });
  commissionIds.push(c.id);
  return c;
}

/** ฐาน 15,000 · ปกส. 750 · ภาษี 100 ⇒ สุทธิก่อนค่าคอม 14,150 */
const line = (userId: string, extra: Record<string, unknown> = {}) => ({ userId, baseSalary: 15000, ssoEmployee: 750, whtAmount: 100, ...extra });
const payload = (period: Period, lines: unknown[]) => ({
  documentDate: DOC_DATE[period],
  payrollPeriod: period,
  entityScope: 'SHOP',
  depositAccountCode: 'S11-1202',
  paymentMethod: 'BANK_TRANSFER',
  lines,
});

async function createDoc(branchId: string, period: Period, lines: unknown[], c: ExpenseDocumentCreateService = creator) {
  setNow(SAVE_AT[period]);
  return c.createPayroll({ branchId, ...payload(period, lines) } as never, OWNER());
}
const updateDoc = (id: string, period: Period, lines: unknown[], c: ExpenseDocumentCreateService = creator) =>
  c.updatePayroll(id, payload(period, lines) as never, OWNER());

/** R20 — `updatedAt` ของใบตามที่หน้ารายละเอียดวาด · อนุมัติใบ PAYROLL ต้องส่งกลับเป็น `expectedUpdatedAt` */
const versionOf = async (id: string) => (await prisma.expenseDocument.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt.toISOString();
const approveAsSeen = async (id: string) => lifecycle.approve(id, ownerId, 'OWNER', { expectedUpdatedAt: await versionOf(id) });
const postAsSeen = async (id: string) => lifecycle.post(id, ownerId, undefined, { expectedUpdatedAt: await versionOf(id) });
/** คำตอบของสร้าง/แก้ใบ (P2-R28) — รายการค่าคอมของบรรทัดพร้อมข้อมูลค่าคอม (include ชุดเดียวกับ findOne) */
const responseItems = (doc: unknown) =>
  (doc as { payroll: { lines: Array<{ commissionItems: Array<{ kind: string; salesCommissionId: string; amount: Prisma.Decimal; releasedAt: Date | null; salesCommission: { id: string; period: string } }> }> } })
    .payroll.lines.flatMap((l) => l.commissionItems)
    .map((i) => ({ kind: i.kind, salesCommissionId: i.salesCommissionId, amount: money(i.amount), released: i.releasedAt !== null, commission: { id: i.salesCommission.id, period: i.salesCommission.period } }));
async function submitAndApprove(id: string, period: Period) {
  setNow(AFTER_CUTOFF[period]);
  await lifecycle.submitForApproval(id, ownerId);
  await approveAsSeen(id);
}
const docOf = (id: string) => prisma.expenseDocument.findUniqueOrThrow({ where: { id } });
const commissionOf = (id: string) => prisma.salesCommission.findUniqueOrThrow({ where: { id } });

async function lineOf(documentId: string, userId: string) {
  const l = await prisma.payrollLine.findFirstOrThrow({
    where: { payroll: { documentId }, userId },
    include: { customIncome: true, customDeduction: true, commissionItems: true },
  });
  return {
    netPaid: money(l.netPaid),
    commissionIncome: l.customIncome.filter((i) => i.source === 'COMMISSION').map((i) => ({ accountCode: i.accountCode, name: i.name, amount: money(i.amount) })),
    deductions: l.customDeduction
      .map((d) => ({ source: d.source, accountCode: d.accountCode, name: d.name, amount: money(d.amount) }))
      .sort((a, b) => `${a.source}|${a.accountCode}`.localeCompare(`${b.source}|${b.accountCode}`)),
    items: l.commissionItems
      .map((i) => ({ salesCommissionId: i.salesCommissionId, kind: i.kind, accountCode: i.accountCode, amount: money(i.amount), released: i.releasedAt !== null }))
      .sort((a, b) => `${a.kind}|${a.salesCommissionId}`.localeCompare(`${b.kind}|${b.salesCommissionId}`)),
    itemIds: l.commissionItems.map((i) => i.id).sort(),
    warnings: (l.systemNotes as SystemNotes | null)?.warnings.filter((w) => COMMISSION_WARNINGS.has(w.code)) ?? [],
  };
}
const itemsOfDoc = (documentId: string) =>
  prisma.payrollCommissionItem.findMany({ where: { payrollLine: { payroll: { documentId } } }, orderBy: { id: 'asc' } });

async function jeLines(documentId: string) {
  const doc = await docOf(documentId);
  if (!doc.journalEntryId) return [];
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: doc.journalEntryId } });
  return lines.map((l) => ({ accountCode: l.accountCode, dr: money(l.debit), cr: money(l.credit) }));
}

async function rejected(p: Promise<unknown>) {
  return p.then(
    () => { throw new Error('expected the call to be refused'); },
    (e: unknown) => e,
  );
}
async function expectConflict(p: Promise<unknown>, body: Record<string, unknown>) {
  const err = await rejected(p);
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).getResponse()).toEqual(body);
}
async function expectBadRequest(p: Promise<unknown>, body: Record<string, unknown>) {
  const err = await rejected(p);
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as BadRequestException).getResponse()).toEqual(body);
}
const diff = (userId: string, employeeName: string, label: string, stored: string, current: string) => ({
  userId,
  employeeName,
  label,
  stored: { amount: stored, hours: null },
  current: { amount: current, hours: null },
});

/** พนักงานขายสาขาใหม่ + ค่าคอม ต.ค. 1,000 (ผูกสัญญา) จ่ายในใบเงินเดือน ต.ค. ที่ลงบัญชีแล้ว */
async function paidInOctober(tag: string) {
  const branchId = await mkBranch(tag);
  const userId = await mkUser(tag, branchId);
  const contract = await mkContract(tag, branchId, userId);
  const commission = await mkCommission(userId, { contractId: contract.id, amount: 1000 });
  const oct = await createDoc(branchId, '2026-10', [line(userId)]);
  await submitAndApprove(oct.id, '2026-10');
  expect((await docOf(oct.id)).status).toBe('POSTED');
  return { branchId, userId, name: `พนักงาน ${tag}`, contract, commission, oct };
}
/** ตัวตั้งเวลาของ cron เรียกคืนค่าคอม (ผ่อนได้ 5 งวด ⇒ 50%) */
async function cronClawback50(contractId: string) {
  setNow('2026-11-10 09:00');
  return commissions.applyClawbackForContract(contractId, 5, 'ผิดนัดชำระก่อนครบ 6 งวด');
}
/** ยกเลิกใบขาย / คืนเครื่องเทิร์น = เรียกคืน 100% ผ่าน helper เดียว */
async function clawBack100(commissionId: string, at = '2026-11-10 09:00') {
  setNow(at);
  const row = await commissionOf(commissionId);
  return prisma.$transaction((tx) => clawBackCommissions(tx, [row], { reason: 'ยกเลิกใบขาย', now: new Date() }));
}

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  await roles.onModuleInit();
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
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await setConfig('approval_enabled', null);
  const docs = await prisma.expenseDocument.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const docIds = docs.map((d) => d.id);
  // ใบเงินเดือน + ใบกลับรายการ (void) ต่างประทับ metadata.documentId ของใบ
  const jeIds =
    docIds.length === 0
      ? []
      : (await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM journal_entries WHERE metadata->>'documentId' IN (${Prisma.join(docIds)})`).map((j) => j.id);
  if (docIds.length > 0) await prisma.expenseDocument.updateMany({ where: { id: { in: docIds } }, data: { journalEntryId: null } });
  if (jeIds.length > 0) {
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
  }
  // ลบใบก่อนค่าคอม: ใบ → รายละเอียด → บรรทัด → รายการค่าคอม (cascade) · ค่าคอม → รายการเป็น RESTRICT (Task 1 carry)
  if (docIds.length > 0) await prisma.expenseDocument.deleteMany({ where: { id: { in: docIds } } });
  await prisma.payrollCommissionItem.deleteMany({ where: { salesCommissionId: { in: commissionIds } } });
  await prisma.salesCommission.deleteMany({ where: { id: { in: commissionIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
  const audited = new Set((await prisma.auditLog.findMany({ where: { userId: { in: userIds } }, select: { userId: true } })).map((r) => r.userId));
  await prisma.user.updateMany({ where: { id: { in: [...audited].filter((id): id is string => !!id) } }, data: { branchId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds.filter((id) => !audited.has(id)) } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.$disconnect();
}, 120_000);

describe('Payroll commission flow — store, gate, pay, void (Postgres)', () => {
  it('save → submit (after cutoff) → approve → POSTED: Dr S51-1101 1,000 · commission PAID (paidAt = document date, paidAmount) · AUTO_POSTED lists the PAY item · a PAID commission is never pulled again', async () => {
    const b = await mkBranch('pay');
    const u = await mkUser('pay', b);
    const c = await mkCommission(u, { amount: 1000 });
    const oct = await createDoc(b, '2026-10', [line(u)]);
    // P2-R28 — คำตอบของสร้างใบมีรายการค่าคอม (เว็บเติมฟอร์มจากคำตอบนี้)
    expect(responseItems(oct)).toEqual([{ kind: 'PAY', salesCommissionId: c.id, amount: '1000.00', released: false, commission: { id: c.id, period: '2026-10' } }]);

    const saved = await lineOf(oct.id, u);
    expect(saved.commissionIncome).toEqual([{ accountCode: COMMISSION_CODE, name: 'ค่าคอมมิชชัน (1 รายการ)', amount: '1000.00' }]);
    expect(saved.items).toEqual([{ salesCommissionId: c.id, kind: 'PAY', accountCode: COMMISSION_CODE, amount: '1000.00', released: false }]);
    expect(saved.deductions).toEqual([]);
    expect(saved.netPaid).toBe('15150.00'); // 15,000 + 1,000 − 750 − 100
    expect(money((await docOf(oct.id)).totalAmount)).toBe('16000.00');
    expect(money((await docOf(oct.id)).netPayment)).toBe('15150.00');
    expect((await commissionOf(c.id)).status).toBe('APPROVED'); // บันทึกร่างไม่แตะสถานะค่าคอม

    await submitAndApprove(oct.id, '2026-10');
    const posted = await docOf(oct.id);
    expect(posted.status).toBe('POSTED');
    const je = await jeLines(oct.id);
    expect(je).toContainEqual({ accountCode: COMMISSION_CODE, dr: '1000.00', cr: '0.00' });
    expect(je).toContainEqual({ accountCode: 'S11-1202', dr: '0.00', cr: '15150.00' });
    expect(money(posted.netPayment)).toBe('15150.00');

    const paid = await commissionOf(c.id);
    expect(paid.status).toBe('PAID');
    // วันที่จ่าย = วันที่กดลงบัญชี (คำตัดสินเจ้าของ 2026-10-28) — ใบถูกประทับวันที่ลงบัญชี (2 พ.ย. ตามนาฬิกาจำลอง) และค่าคอมจ่ายวันเดียวกัน
    expect(posted.documentDate.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(paid.paidAt?.toISOString()).toBe(posted.documentDate.toISOString());
    expect(money(paid.paidAmount)).toBe('1000.00');
    const items = await itemsOfDoc(oct.id);
    expect(items.map((i) => [i.kind, i.releasedAt])).toEqual([['PAY', null]]);
    const autoPosted = await prisma.auditLog.findFirstOrThrow({ where: { action: 'AUTO_POSTED', entityId: oct.id } });
    expect(autoPosted.newValue).toMatchObject({ status: 'POSTED', commissionItemIds: [items[0].id] });

    // Task 3 carry — ค่าคอมที่ PAID แล้วไม่ถูกดึงซ้ำ (ไม่มีแถว ไม่มีรายการ ไม่มีคำเตือน "อยู่ในใบอื่น")
    const nov = await createDoc(b, '2026-11', [line(u)]);
    const next = await lineOf(nov.id, u);
    expect(next).toMatchObject({ commissionIncome: [], items: [], deductions: [], warnings: [], netPaid: '14150.00' });
  });

  it('Review Focus 2 — two drafts, one commission: the second (another branch) saves without it and shows COMMISSION_IN_OTHER_DOCUMENT (no 409)', async () => {
    const b1 = await mkBranch('two-a');
    const b2 = await mkBranch('two-b');
    const u = await mkUser('two', b1);
    const c = await mkCommission(u, { amount: 1000 });
    const a = await createDoc(b1, '2026-10', [line(u)]);
    expect((await lineOf(a.id, u)).items).toEqual([{ salesCommissionId: c.id, kind: 'PAY', accountCode: COMMISSION_CODE, amount: '1000.00', released: false }]);

    const second = await createDoc(b2, '2026-10', [line(u)]);
    const l = await lineOf(second.id, u);
    expect(l.commissionIncome).toEqual([]);
    expect(l.items).toEqual([]);
    expect(l.netPaid).toBe('14150.00');
    expect(l.warnings).toEqual([{ code: 'COMMISSION_IN_OTHER_DOCUMENT', count: 1, documentId: a.id, documentNumber: a.number }]);
  });

  it('soft-deleting a draft frees its commission (items released · DELETED audit lists them) — the other draft pulls it on its next save', async () => {
    const b1 = await mkBranch('del-a');
    const b2 = await mkBranch('del-b');
    const u = await mkUser('del', b1);
    const c = await mkCommission(u, { amount: 800 });
    const a = await createDoc(b1, '2026-10', [line(u)]);
    const other = await createDoc(b2, '2026-10', [line(u)]);
    expect((await lineOf(other.id, u)).items).toEqual([]);
    const held = await itemsOfDoc(a.id);

    await lifecycle.softDelete(a.id, ownerId);
    const released = await itemsOfDoc(a.id);
    expect(released).toHaveLength(1);
    expect(released[0].releasedAt).not.toBeNull();
    const deleted = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DELETED', entityId: a.id } });
    expect(deleted.newValue).toMatchObject({ releasedCommissionItemIds: [held[0].id] });
    expect((await commissionOf(c.id)).status).toBe('APPROVED');

    const updated = await updateDoc(other.id, '2026-10', [line(u)]);
    // P2-R28 — คำตอบของแก้ใบมีรายการค่าคอมด้วย
    expect(responseItems(updated)).toEqual([{ kind: 'PAY', salesCommissionId: c.id, amount: '800.00', released: false, commission: { id: c.id, period: '2026-10' } }]);
    const pulled = await lineOf(other.id, u);
    expect(pulled.items).toEqual([{ salesCommissionId: c.id, kind: 'PAY', accountCode: COMMISSION_CODE, amount: '800.00', released: false }]);
    expect(pulled.warnings).toEqual([]);
  });

  it('Review Focus 1 — paid in October → cron 50% → November: COMMISSION 1,000.00 · deduction 500.00 Cr the PAY item account (role remapped since) · carried 0 · netPaid / netPayment / JE agree · findOne carries the items', async () => {
    const { branchId, userId, contract, commission } = await paidInOctober('rf1');
    const res = await cronClawback50(contract.id);
    expect(res).toEqual({ clawedBackCount: 1, totalAmount: '500', percent: 50 });
    const clawed = await commissionOf(commission.id);
    expect(clawed.status).toBe('PARTIALLY_CLAWED_BACK');
    expect(money(clawed.clawbackAmount)).toBe('500.00');

    const novCommission = await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const role = await prisma.accountRoleMap.findFirstOrThrow({ where: { role: 'shop_payroll_commission', accountCode: COMMISSION_CODE, isActive: true } });
    await prisma.accountRoleMap.update({ where: { id: role.id }, data: { accountCode: 'S51-1102' } });
    try {
      const nov = await createDoc(branchId, '2026-11', [line(userId)]);
      const l = await lineOf(nov.id, userId);
      expect(l.commissionIncome).toEqual([{ accountCode: 'S51-1102', name: 'ค่าคอมมิชชัน (1 รายการ)', amount: '1000.00' }]);
      expect(l.deductions).toEqual([{ source: 'COMMISSION_CLAWBACK', accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: '500.00' }]);
      expect(l.items).toEqual(
        [
          { salesCommissionId: commission.id, kind: 'CLAWBACK', accountCode: COMMISSION_CODE, amount: '500.00', released: false },
          { salesCommissionId: novCommission.id, kind: 'PAY', accountCode: 'S51-1102', amount: '1000.00', released: false },
        ].sort((a, b) => `${a.kind}|${a.salesCommissionId}`.localeCompare(`${b.kind}|${b.salesCommissionId}`)),
      );
      expect(l.warnings).toEqual([]); // ยกไป 0 ⇒ ไม่มี CLAWBACK_CARRIED
      expect(l.netPaid).toBe('14650.00'); // 15,000 + 1,000 − 500 − 750 − 100
      const stored = await docOf(nov.id);
      expect(money(stored.totalAmount)).toBe('16000.00');
      expect(money(stored.netPayment)).toBe('14650.00');

      const view = (await query.findOne(nov.id, 'OWNER')) as unknown as {
        payroll: { lines: Array<{ commissionItems: Array<{ kind: string; releasedAt: Date | null; salesCommission: Record<string, unknown> }> }> };
      };
      const claw = view.payroll.lines[0].commissionItems.find((i) => i.kind === 'CLAWBACK')!;
      expect(claw.releasedAt).toBeNull();
      expect(claw.salesCommission).toMatchObject({
        id: commission.id,
        period: '2026-10',
        status: 'PARTIALLY_CLAWED_BACK',
        clawbackReason: 'ผิดนัดชำระก่อนครบ 6 งวด',
        contract: { contractNumber: contract.contractNumber },
        sale: null,
      });
      expect(claw.salesCommission.clawbackAt).toBeInstanceOf(Date);
      expect(money(claw.salesCommission.commissionAmount as Prisma.Decimal)).toBe('1000.00');

      await submitAndApprove(nov.id, '2026-11');
      const posted = await docOf(nov.id);
      expect(posted.status).toBe('POSTED');
      expect(money(posted.netPayment)).toBe('14650.00');
      const je = await jeLines(nov.id);
      expect(je).toContainEqual({ accountCode: 'S51-1102', dr: '1000.00', cr: '0.00' });
      expect(je).toContainEqual({ accountCode: COMMISSION_CODE, dr: '0.00', cr: '500.00' });
      expect(je).toContainEqual({ accountCode: 'S11-1202', dr: '0.00', cr: '14650.00' });
      expect((await commissionOf(novCommission.id)).status).toBe('PAID');
      const oct = await commissionOf(commission.id);
      expect(oct.status).toBe('PARTIALLY_CLAWED_BACK'); // หักคืนไม่แตะแถวค่าคอม — ยอดคงเหลือ = clawbackAmount − Σ รายการ CLAWBACK
      expect(money(oct.paidAmount)).toBe('1000.00');
    } finally {
      await prisma.accountRoleMap.update({ where: { id: role.id }, data: { accountCode: COMMISSION_CODE } });
    }
  });

  it('Review Focus 1 sibling — November with no commission: no deduction row, no CLAWBACK item, CLAWBACK_CARRIED 0.00 / 500.00', async () => {
    const { branchId, userId, contract } = await paidInOctober('rf1-none');
    await cronClawback50(contract.id);
    const nov = await createDoc(branchId, '2026-11', [line(userId)]);
    const l = await lineOf(nov.id, userId);
    expect(l).toMatchObject({ commissionIncome: [], deductions: [], items: [], netPaid: '14150.00' });
    expect(l.warnings).toEqual([{ code: 'CLAWBACK_CARRIED', deducted: '0.00', carried: '500.00' }]);
  });

  it('Review Focus 3 — one clawback, two drafts in different periods: the second deducts 0 (no row, no item, no carry)', async () => {
    const { branchId, userId, contract, commission } = await paidInOctober('rf3');
    await cronClawback50(contract.id);
    const novCommission = await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const nov = await createDoc(branchId, '2026-11', [line(userId)]);
    expect((await lineOf(nov.id, userId)).deductions).toEqual([
      { source: 'COMMISSION_CLAWBACK', accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: '500.00' },
    ]);

    const decCommission = await mkCommission(userId, { period: '2026-12', amount: 800 });
    const dec = await createDoc(branchId, '2026-12', [line(userId)]);
    const l = await lineOf(dec.id, userId);
    expect(l.commissionIncome).toEqual([{ accountCode: COMMISSION_CODE, name: 'ค่าคอมมิชชัน (1 รายการ)', amount: '800.00' }]);
    expect(l.deductions).toEqual([]);
    expect(l.items).toEqual([{ salesCommissionId: decCommission.id, kind: 'PAY', accountCode: COMMISSION_CODE, amount: '800.00', released: false }]);
    expect(l.warnings).toEqual([{ code: 'COMMISSION_IN_OTHER_DOCUMENT', count: 1, documentId: nov.id, documentNumber: nov.number }]);
    expect(l.netPaid).toBe('14950.00');
    expect((await itemsOfDoc(dec.id)).some((i) => i.salesCommissionId === commission.id)).toBe(false);
    expect((await itemsOfDoc(nov.id)).some((i) => i.salesCommissionId === novCommission.id)).toBe(true);
  });

  it('a draft holding a 500.00 clawback row edited from the form payload (MANUAL deductions only) then submitted → still exactly one COMMISSION_CLAWBACK 500.00 and no MANUAL S51-1101 · a MANUAL S51-1101 deduction on that line → 400 PAYROLL_CLAWBACK_DUPLICATE (also when echoing the stored row) · allowed on a line without a clawback', async () => {
    const { branchId, userId, name, contract } = await paidInOctober('edit');
    await cronClawback50(contract.id);
    await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const v = await mkUser('edit-v', branchId);
    await mkCommission(v, { period: '2026-11', amount: 400 });
    const nov = await createDoc(branchId, '2026-11', [line(userId), line(v)]);
    expect((await lineOf(nov.id, userId)).deductions).toHaveLength(1);

    // Task 6 payload: รายการหักที่ฟอร์มส่ง = เฉพาะ MANUAL ที่เก็บไว้ (ไม่ส่งแถวหักคืนของระบบ) + รายได้ที่กรอกเอง
    const formLines = [
      line(userId, {
        customIncome: [{ accountCode: 'S52-1204', name: 'โบนัส', amount: 300 }],
        customDeduction: [{ accountCode: 'S21-1103', name: 'หักคืนเงินยืม', amount: 200 }],
      }),
      // บรรทัดที่ไม่มีแถวหักคืน — รายการหักบนบัญชีค่าคอมที่กรอกเองรับได้ (กติกา CLAWBACK_DUPLICATE ใช้เฉพาะบรรทัดที่มีแถวหักคืน)
      line(v, { customDeduction: [{ accountCode: COMMISSION_CODE, name: 'หักค่าคอมจ่ายเกิน (กรอกเอง)', amount: 100 }] }),
    ];
    setNow('2026-11-30 21:00');
    await updateDoc(nov.id, '2026-11', formLines);
    const expectedDeductions = [
      { source: 'COMMISSION_CLAWBACK', accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: '500.00' },
      { source: 'MANUAL', accountCode: 'S21-1103', name: 'หักคืนเงินยืม', amount: '200.00' },
    ];
    const edited = await lineOf(nov.id, userId);
    expect(edited.deductions).toEqual(expectedDeductions);
    expect(edited.netPaid).toBe('14750.00'); // 15,000 + 300 + 1,000 − 500 − 200 − 750 − 100
    expect((await lineOf(nov.id, v)).deductions).toEqual([
      { source: 'MANUAL', accountCode: COMMISSION_CODE, name: 'หักค่าคอมจ่ายเกิน (กรอกเอง)', amount: '100.00' },
    ]);

    setNow(AFTER_CUTOFF['2026-11']);
    await lifecycle.submitForApproval(nov.id, ownerId);
    expect((await docOf(nov.id)).status).toBe('PENDING_APPROVAL');
    const submitted = await lineOf(nov.id, userId);
    expect(submitted.deductions).toEqual(expectedDeductions);
    expect(submitted.items.filter((i) => i.kind === 'CLAWBACK')).toEqual([
      { salesCommissionId: expect.any(String), kind: 'CLAWBACK', accountCode: COMMISSION_CODE, amount: '500.00', released: false },
    ]);
    expect(submitted.netPaid).toBe('14750.00');
    expect((await lineOf(nov.id, v)).deductions).toEqual([
      { source: 'MANUAL', accountCode: COMMISSION_CODE, name: 'หักค่าคอมจ่ายเกิน (กรอกเอง)', amount: '100.00' },
    ]);

    const before = await lineOf(nov.id, userId);
    for (const deduction of [
      { accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: 500 }, // เว็บวันนี้ส่งแถวที่เก็บกลับมาทั้งหมด
      { accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอมเพิ่ม', amount: 120 },
    ]) {
      await expectBadRequest(updateDoc(nov.id, '2026-11', [line(userId, { customDeduction: [deduction] }), line(v)]), {
        code: 'PAYROLL_CLAWBACK_DUPLICATE',
        message: clawbackDuplicate(name),
      });
    }
    expect((await docOf(nov.id)).status).toBe('PENDING_APPROVAL');
    expect(await lineOf(nov.id, userId)).toEqual(before);
  });

  it('Review Focus 5 (b) — a new October commission approved after submit: approve passes, it is not paid, and the November payroll pulls it', async () => {
    const b = await mkBranch('late');
    const u = await mkUser('late', b);
    const first = await mkCommission(u, { amount: 1000 });
    const oct = await createDoc(b, '2026-10', [line(u)]);
    setNow(AFTER_CUTOFF['2026-10']);
    await lifecycle.submitForApproval(oct.id, ownerId);

    const late = await mkCommission(u, { amount: 700 });
    await approveAsSeen(oct.id);
    expect((await docOf(oct.id)).status).toBe('POSTED');
    expect((await commissionOf(first.id)).status).toBe('PAID');
    const lateRow = await commissionOf(late.id);
    expect(lateRow.status).toBe('APPROVED');
    expect(lateRow.paidAt).toBeNull();

    const nov = await createDoc(b, '2026-11', [line(u)]);
    const l = await lineOf(nov.id, u);
    expect(l.commissionIncome).toEqual([{ accountCode: COMMISSION_CODE, name: 'ค่าคอมมิชชัน (1 รายการ)', amount: '700.00' }]);
    expect(l.items).toEqual([{ salesCommissionId: late.id, kind: 'PAY', accountCode: COMMISSION_CODE, amount: '700.00', released: false }]);
  });

  it('Review Focus 5 (a) — a commission clawed back between submit and approve → PAYROLL_STALE with a diff for that commission · stays PENDING_APPROVAL, no JE · the re-save drops it', async () => {
    const b = await mkBranch('stale');
    const u = await mkUser('stale', b);
    const c = await mkCommission(u, { amount: 1000 });
    const oct = await createDoc(b, '2026-10', [line(u)]);
    setNow(AFTER_CUTOFF['2026-10']);
    await lifecycle.submitForApproval(oct.id, ownerId);

    await clawBack100(c.id); // ยังไม่จ่าย ⇒ CLAWED_BACK · clawbackAmount null
    setNow(AFTER_CUTOFF['2026-10']);
    await expectConflict(approveAsSeen(oct.id), {
      code: 'PAYROLL_STALE',
      diffs: [diff(u, 'พนักงาน stale', `ค่าคอม ${c.id}`, '1000.00', '0.00')],
      message: STALE,
    });
    const held = await docOf(oct.id);
    expect(held.status).toBe('PENDING_APPROVAL');
    expect(held.journalEntryId).toBeNull();
    expect((await commissionOf(c.id)).paidAt).toBeNull();

    await updateDoc(oct.id, '2026-10', [line(u)]);
    expect(await lineOf(oct.id, u)).toMatchObject({ commissionIncome: [], items: [], netPaid: '14150.00' });
  });

  it('stored COMMISSION income / COMMISSION_CLAWBACK deduction tampered in the DB → PAYROLL_STALE labelled with the row name · restored → approve posts', async () => {
    const { branchId, userId, name, contract } = await paidInOctober('tamper');
    await cronClawback50(contract.id);
    await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const nov = await createDoc(branchId, '2026-11', [line(userId)]);
    setNow(AFTER_CUTOFF['2026-11']);
    await lifecycle.submitForApproval(nov.id, ownerId);
    const where = { payrollLine: { payroll: { documentId: nov.id } } };

    await prisma.payrollCustomIncome.updateMany({ where: { ...where, source: 'COMMISSION' }, data: { amount: 900 } });
    await expectConflict(approveAsSeen(nov.id), {
      code: 'PAYROLL_STALE',
      diffs: [diff(userId, name, 'ค่าคอมมิชชัน (1 รายการ)', '900.00', '1000.00')],
      message: STALE,
    });
    await prisma.payrollCustomIncome.updateMany({ where: { ...where, source: 'COMMISSION' }, data: { amount: 1000 } });

    await prisma.payrollCustomDeduction.updateMany({ where: { ...where, source: 'COMMISSION_CLAWBACK' }, data: { amount: 450 } });
    await expectConflict(approveAsSeen(nov.id), {
      code: 'PAYROLL_STALE',
      diffs: [diff(userId, name, 'หักคืนค่าคอม (1 รายการ)', '450.00', '500.00')],
      message: STALE,
    });
    await prisma.payrollCustomDeduction.updateMany({ where: { ...where, source: 'COMMISSION_CLAWBACK' }, data: { amount: 500 } });

    await approveAsSeen(nov.id);
    expect((await docOf(nov.id)).status).toBe('POSTED');
  });

  it('a resignee\'s final-month clawback nets against that month\'s commission (capped, the rest carried)', async () => {
    const b = await mkBranch('resign');
    const u = await mkUser('resign', b, { resignedDate: bangkokMidnight(2026, 10, 15) });
    const c = await mkCommission(u, { amount: 1000 });
    const oct = await createDoc(b, '2026-10', [line(u)]);
    await submitAndApprove(oct.id, '2026-10');
    await clawBack100(c.id); // จ่ายแล้ว 100% ⇒ CLAWED_BACK · clawbackAmount = ยอดที่จ่าย
    expect(money((await commissionOf(c.id)).clawbackAmount)).toBe('1000.00');

    const finalMonth = await mkCommission(u, { period: '2026-11', amount: 600 });
    const nov = await createDoc(b, '2026-11', [line(u)]);
    const l = await lineOf(nov.id, u);
    expect(l.commissionIncome).toEqual([{ accountCode: COMMISSION_CODE, name: 'ค่าคอมมิชชัน (1 รายการ)', amount: '600.00' }]);
    expect(l.deductions).toEqual([{ source: 'COMMISSION_CLAWBACK', accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: '600.00' }]);
    expect(l.warnings).toEqual([{ code: 'CLAWBACK_CARRIED', deducted: '600.00', carried: '400.00' }]);
    expect(l.netPaid).toBe('14150.00');

    await submitAndApprove(nov.id, '2026-11');
    expect((await docOf(nov.id)).status).toBe('POSTED');
    const je = await jeLines(nov.id);
    expect(je).toContainEqual({ accountCode: COMMISSION_CODE, dr: '600.00', cr: '0.00' });
    expect(je).toContainEqual({ accountCode: COMMISSION_CODE, dr: '0.00', cr: '600.00' });
    expect((await commissionOf(finalMonth.id)).status).toBe('PAID');
  });

  it('Review Focus 4 (c) — void of a plain paying document: commission back to APPROVED (paidAt / paidAmount cleared) · items released (EXPENSE_VOIDED lists them) · a new document pulls it', async () => {
    const b = await mkBranch('void');
    const u = await mkUser('void', b);
    const c = await mkCommission(u, { amount: 1000 });
    const oct = await createDoc(b, '2026-10', [line(u)]);
    await submitAndApprove(oct.id, '2026-10');
    const [payItem] = await itemsOfDoc(oct.id);

    setNow('2026-11-03 10:00');
    await lifecycle.voidDocument(oct.id, ownerId, VOID_DTO);
    expect((await docOf(oct.id)).status).toBe('VOIDED');
    const back = await commissionOf(c.id);
    expect(back.status).toBe('APPROVED');
    expect(back.paidAt).toBeNull();
    expect(back.paidAmount).toBeNull();
    expect((await itemsOfDoc(oct.id))[0].releasedAt).not.toBeNull();
    const voided = await prisma.auditLog.findFirstOrThrow({ where: { action: 'EXPENSE_VOIDED', entityId: oct.id } });
    expect(voided.newValue).toMatchObject({ releasedCommissionItemIds: [payItem.id] });

    const redo = await createDoc(b, '2026-10', [line(u)]);
    expect((await lineOf(redo.id, u)).items).toEqual([{ salesCommissionId: c.id, kind: 'PAY', accountCode: COMMISSION_CODE, amount: '1000.00', released: false }]);
  });

  it('void of the deducting document → the November commission goes back to APPROVED and the next save deducts again', async () => {
    const { branchId, userId, contract, commission } = await paidInOctober('void-deduct');
    await cronClawback50(contract.id);
    const novCommission = await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const nov = await createDoc(branchId, '2026-11', [line(userId)]);
    await submitAndApprove(nov.id, '2026-11');
    expect((await commissionOf(novCommission.id)).status).toBe('PAID');

    setNow('2026-12-03 10:00');
    await lifecycle.voidDocument(nov.id, ownerId, VOID_DTO);
    expect((await docOf(nov.id)).status).toBe('VOIDED');
    expect((await commissionOf(novCommission.id)).status).toBe('APPROVED');
    const oct = await commissionOf(commission.id);
    expect(oct.status).toBe('PARTIALLY_CLAWED_BACK');
    expect(money(oct.clawbackAmount)).toBe('500.00');
    expect((await itemsOfDoc(nov.id)).every((i) => i.releasedAt !== null)).toBe(true);

    const redo = await createDoc(branchId, '2026-11', [line(userId)]);
    const l = await lineOf(redo.id, userId);
    expect(l.deductions).toEqual([{ source: 'COMMISSION_CLAWBACK', accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: '500.00' }]);
    expect(l.commissionIncome).toEqual([{ accountCode: COMMISSION_CODE, name: 'ค่าคอมมิชชัน (1 รายการ)', amount: '1000.00' }]);
  });

  it('Review Focus 4 (a) — a 100% clawback deducted in a POSTED November: voiding October → 409 PAYROLL_VOID_AFTER_CLAWBACK naming November (nothing changes) · after November is voided, the October void goes through and clears paidAt / paidAmount / clawbackAmount', async () => {
    const { branchId, userId, commission, oct } = await paidInOctober('void-after');
    await clawBack100(commission.id); // จ่ายแล้ว 100% ⇒ CLAWED_BACK · clawbackAmount 1,000
    const novCommission = await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const nov = await createDoc(branchId, '2026-11', [line(userId)]);
    expect((await lineOf(nov.id, userId)).deductions).toEqual([
      { source: 'COMMISSION_CLAWBACK', accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: '1000.00' },
    ]);
    await submitAndApprove(nov.id, '2026-11');
    expect((await docOf(nov.id)).status).toBe('POSTED');

    setNow('2026-12-03 10:00');
    await expectConflict(lifecycle.voidDocument(oct.id, ownerId, VOID_DTO), {
      code: 'PAYROLL_VOID_AFTER_CLAWBACK',
      documentNumber: nov.number,
      message: voidAfterClawback(nov.number),
    });
    expect((await docOf(oct.id)).status).toBe('POSTED');
    const held = await commissionOf(commission.id);
    expect(held.status).toBe('CLAWED_BACK');
    expect(held.paidAt).not.toBeNull();
    expect(money(held.clawbackAmount)).toBe('1000.00');
    expect((await itemsOfDoc(oct.id)).every((i) => i.releasedAt === null)).toBe(true);

    // ทางที่ข้อความบอกต้องสำเร็จจริง: กลับรายการ พ.ย. ก่อน → แล้วกลับรายการ ต.ค. ได้
    await lifecycle.voidDocument(nov.id, ownerId, VOID_DTO);
    expect((await docOf(nov.id)).status).toBe('VOIDED');
    expect((await commissionOf(novCommission.id)).status).toBe('APPROVED');
    await lifecycle.voidDocument(oct.id, ownerId, VOID_DTO);
    expect((await docOf(oct.id)).status).toBe('VOIDED');
    const undone = await commissionOf(commission.id);
    expect(undone.status).toBe('CLAWED_BACK');
    expect(undone.paidAt).toBeNull();
    expect(undone.paidAmount).toBeNull();
    expect(undone.clawbackAmount).toBeNull();
    expect((await itemsOfDoc(oct.id)).every((i) => i.releasedAt !== null)).toBe(true);
  });

  it('fix round 1 — a partial clawback deducted in a POSTED November: voiding October → 409 PAYROLL_VOID_PARTIAL_CLAWBACK (terminal), not VOID_AFTER_CLAWBACK (which would send the user to reverse a correct payroll for nothing)', async () => {
    const { branchId, userId, contract, commission, oct } = await paidInOctober('void-partial-posted');
    await cronClawback50(contract.id);
    await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const nov = await createDoc(branchId, '2026-11', [line(userId)]);
    await submitAndApprove(nov.id, '2026-11');
    expect((await docOf(nov.id)).status).toBe('POSTED');
    expect((await itemsOfDoc(nov.id)).some((i) => i.kind === 'CLAWBACK' && i.salesCommissionId === commission.id)).toBe(true);

    setNow('2026-12-03 10:00');
    await expectConflict(lifecycle.voidDocument(oct.id, ownerId, VOID_DTO), {
      code: 'PAYROLL_VOID_PARTIAL_CLAWBACK',
      message: voidPartialClawback(contract.contractNumber),
    });
    expect((await docOf(oct.id)).status).toBe('POSTED');
    expect((await docOf(nov.id)).status).toBe('POSTED');
    const row = await commissionOf(commission.id);
    expect(row.status).toBe('PARTIALLY_CLAWED_BACK');
    expect(row.paidAt).not.toBeNull();
  });

  it('Review Focus 4 (b) — void after a partial clawback (deducted only in a draft) → 409 PAYROLL_VOID_PARTIAL_CLAWBACK with the contract reference', async () => {
    const { branchId, userId, contract, oct } = await paidInOctober('void-partial');
    await cronClawback50(contract.id);
    await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const nov = await createDoc(branchId, '2026-11', [line(userId)]); // ร่าง (ไม่ได้ลงบัญชี) ถือรายการ CLAWBACK
    expect((await lineOf(nov.id, userId)).deductions).toHaveLength(1);

    setNow('2026-12-03 10:00');
    await expectConflict(lifecycle.voidDocument(oct.id, ownerId, VOID_DTO), {
      code: 'PAYROLL_VOID_PARTIAL_CLAWBACK',
      message: voidPartialClawback(contract.contractNumber),
    });
    expect((await docOf(oct.id)).status).toBe('POSTED');
  });

  it('P2-R5 — a 100% clawback deducted only in a draft does not block the void: the commission loses paidAt / paidAmount / clawbackAmount · the draft\'s approve is stale (d) · its re-save drops the clawback', async () => {
    const { branchId, userId, name, contract, commission, oct } = await paidInOctober('void-full');
    await clawBack100(commission.id);
    await mkCommission(userId, { period: '2026-11', amount: 1000 });
    const nov = await createDoc(branchId, '2026-11', [line(userId)]);
    expect((await lineOf(nov.id, userId)).deductions).toEqual([
      { source: 'COMMISSION_CLAWBACK', accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: '1000.00' },
    ]);
    setNow(AFTER_CUTOFF['2026-11']);
    await lifecycle.submitForApproval(nov.id, ownerId);

    await lifecycle.voidDocument(oct.id, ownerId, VOID_DTO);
    expect((await docOf(oct.id)).status).toBe('VOIDED');
    const row = await commissionOf(commission.id);
    expect(row.status).toBe('CLAWED_BACK');
    expect(row.paidAt).toBeNull();
    expect(row.paidAmount).toBeNull();
    expect(row.clawbackAmount).toBeNull();

    await expectConflict(approveAsSeen(nov.id), {
      code: 'PAYROLL_STALE',
      diffs: [diff(userId, name, `หักคืนค่าคอม ${contract.contractNumber}`, '1000.00', '0.00')],
      message: STALE,
    });
    await updateDoc(nov.id, '2026-11', [line(userId)]);
    const l = await lineOf(nov.id, userId);
    expect(l.deductions).toEqual([]);
    expect(l.netPaid).toBe('15150.00');
  });

  it('void of a non-posted payroll only releases its items (the commission stays APPROVED) and a new document pulls it', async () => {
    const b = await mkBranch('void-draft');
    const u = await mkUser('void-draft', b);
    const c = await mkCommission(u, { amount: 650 });
    const oct = await createDoc(b, '2026-10', [line(u)]);
    setNow(AFTER_CUTOFF['2026-10']);
    await lifecycle.submitForApproval(oct.id, ownerId);

    await lifecycle.voidDocument(oct.id, ownerId, VOID_DTO);
    expect((await docOf(oct.id)).status).toBe('VOIDED');
    expect((await commissionOf(c.id)).status).toBe('APPROVED');
    expect((await itemsOfDoc(oct.id)).every((i) => i.releasedAt !== null)).toBe(true);
    const redo = await createDoc(b, '2026-10', [line(u)]);
    expect((await lineOf(redo.id, u)).items).toEqual([{ salesCommissionId: c.id, kind: 'PAY', accountCode: COMMISSION_CODE, amount: '650.00', released: false }]);
  });

  it('markCommissionsPaid: a PAY item whose commission is no longer APPROVED or changed amount → PAYROLL_STALE with a diff for that commission (count ≠ 1) · otherwise returns the item ids', async () => {
    const b = await mkBranch('mark');
    const u = await mkUser('mark', b);
    const c = await mkCommission(u, { amount: 1000 });
    const doc = await createDoc(b, '2026-10', [line(u)]);
    const [item] = await itemsOfDoc(doc.id);
    const mark = () => prisma.$transaction((tx) => gate.markCommissionsPaid(tx, doc.id, new Date(DOC_DATE['2026-10'])));

    await prisma.salesCommission.update({ where: { id: c.id }, data: { status: 'PENDING' } });
    await expectConflict(mark(), { code: 'PAYROLL_STALE', diffs: [diff(u, 'พนักงาน mark', `ค่าคอม ${c.id}`, '1000.00', '0.00')], message: STALE });
    await prisma.salesCommission.update({ where: { id: c.id }, data: { status: 'APPROVED', commissionAmount: 900 } });
    await expectConflict(mark(), { code: 'PAYROLL_STALE', diffs: [diff(u, 'พนักงาน mark', `ค่าคอม ${c.id}`, '1000.00', '900.00')], message: STALE });
    expect((await commissionOf(c.id)).status).toBe('APPROVED');

    await prisma.salesCommission.update({ where: { id: c.id }, data: { commissionAmount: 1000 } });
    expect(await mark()).toEqual([item.id]);
    const paid = await commissionOf(c.id);
    expect(paid.status).toBe('PAID');
    expect(money(paid.paidAmount)).toBe('1000.00');
  });

  it('P2-R28 (a) — approve with auto_post_on_approve off leaves the commission APPROVED (no JE) · post() of the APPROVED document pays it (PAID, paidAmount) · the JE carries Dr S51-1101 · POSTED lists the PAY item', async () => {
    const b = await mkBranch('manual-post');
    const u = await mkUser('manual-post', b);
    const c = await mkCommission(u, { amount: 1200 });
    const oct = await createDoc(b, '2026-10', [line(u)]);
    await setConfig('auto_post_on_approve', 'false');
    try {
      await submitAndApprove(oct.id, '2026-10');
      const approved = await docOf(oct.id);
      expect(approved.status).toBe('APPROVED');
      expect(approved.journalEntryId).toBeNull();
      expect((await commissionOf(c.id)).status).toBe('APPROVED');

      await postAsSeen(oct.id);
      const posted = await docOf(oct.id);
      expect(posted.status).toBe('POSTED');
      const paid = await commissionOf(c.id);
      expect(paid.status).toBe('PAID');
      expect(paid.paidAt?.toISOString()).toBe(posted.documentDate.toISOString()); // วันที่กดลงบัญชี
      expect(money(paid.paidAmount)).toBe('1200.00');
      const je = await jeLines(oct.id);
      expect(je).toContainEqual({ accountCode: COMMISSION_CODE, dr: '1200.00', cr: '0.00' });
      expect(je).toContainEqual({ accountCode: 'S11-1202', dr: '0.00', cr: '15350.00' }); // 15,000 + 1,200 − 750 − 100
      const [payItem] = await itemsOfDoc(oct.id);
      const postedAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'POSTED', entityId: oct.id } });
      expect(postedAudit.newValue).toMatchObject({ commissionItemIds: [payItem.id] });
    } finally {
      await setConfig('auto_post_on_approve', null);
    }
  });

  it('P2-R28 (b) — clawbacks on two accounts (role remapped between the payments): one deduction row per PAY-item account, gate check (b) passes, the JE credits each account its own amount', async () => {
    const b = await mkBranch('two-accounts');
    const u = await mkUser('two-accounts', b);
    const octCommission = await mkCommission(u, { period: '2026-10', amount: 1000 });
    const oct = await createDoc(b, '2026-10', [line(u)]);
    await submitAndApprove(oct.id, '2026-10'); // PAY item บน S51-1101

    const role = await prisma.accountRoleMap.findFirstOrThrow({ where: { role: 'shop_payroll_commission', accountCode: COMMISSION_CODE, isActive: true } });
    await prisma.accountRoleMap.update({ where: { id: role.id }, data: { accountCode: 'S51-1102' } });
    let novCommission: { id: string };
    try {
      novCommission = await mkCommission(u, { period: '2026-11', amount: 600 });
      const nov = await createDoc(b, '2026-11', [line(u)]);
      await submitAndApprove(nov.id, '2026-11'); // PAY item บน S51-1102
      expect((await itemsOfDoc(nov.id)).map((i) => [i.kind, i.accountCode])).toEqual([['PAY', 'S51-1102']]);
    } finally {
      await prisma.accountRoleMap.update({ where: { id: role.id }, data: { accountCode: COMMISSION_CODE } });
    }
    await clawBack100(octCommission.id, '2026-12-10 09:00');
    await clawBack100(novCommission.id, '2026-12-10 09:00');

    await mkCommission(u, { period: '2026-12', amount: 2000 });
    const dec = await createDoc(b, '2026-12', [line(u)]);
    const l = await lineOf(dec.id, u);
    expect(l.commissionIncome).toEqual([{ accountCode: COMMISSION_CODE, name: 'ค่าคอมมิชชัน (1 รายการ)', amount: '2000.00' }]);
    expect(l.deductions).toEqual([
      { source: 'COMMISSION_CLAWBACK', accountCode: COMMISSION_CODE, name: 'หักคืนค่าคอม (1 รายการ)', amount: '1000.00' },
      { source: 'COMMISSION_CLAWBACK', accountCode: 'S51-1102', name: 'หักคืนค่าคอม (1 รายการ)', amount: '600.00' },
    ]);
    expect(l.items.filter((i) => i.kind === 'CLAWBACK').map((i) => [i.salesCommissionId, i.accountCode, i.amount]).sort()).toEqual(
      [
        [octCommission.id, COMMISSION_CODE, '1000.00'],
        [novCommission.id, 'S51-1102', '600.00'],
      ].sort(),
    );
    expect(l.warnings).toEqual([]);
    expect(l.netPaid).toBe('14550.00'); // 15,000 + 2,000 − 1,000 − 600 − 750 − 100

    await submitAndApprove(dec.id, '2026-12'); // ด่าน (b): ยอดหักต่อบัญชี = Σ รายการ CLAWBACK ต่อบัญชี ⇒ ไม่ stale
    const posted = await docOf(dec.id);
    expect(posted.status).toBe('POSTED');
    expect(money(posted.netPayment)).toBe('14550.00');
    const je = await jeLines(dec.id);
    expect(je).toContainEqual({ accountCode: COMMISSION_CODE, dr: '2000.00', cr: '0.00' });
    expect(je).toContainEqual({ accountCode: COMMISSION_CODE, dr: '0.00', cr: '1000.00' });
    expect(je).toContainEqual({ accountCode: 'S51-1102', dr: '0.00', cr: '600.00' });
    expect(je).toContainEqual({ accountCode: 'S11-1202', dr: '0.00', cr: '14550.00' });
    expect(je.filter((j) => j.accountCode === 'S51-1102')).toHaveLength(1);
  });

  it('P2-R4 — a live PAY item already held elsewhere hitting the partial unique index (create and update) → 409 PAYROLL_COMMISSION_TAKEN · nothing written', async () => {
    const b1 = await mkBranch('taken-a');
    const b2 = await mkBranch('taken-b');
    const u = await mkUser('taken', b1);
    const c = await mkCommission(u, { amount: 1000 });
    const holder = await createDoc(b1, '2026-10', [line(u)]);
    const holderItems = await itemsOfDoc(holder.id);

    // compute ที่ "พลาด" (จำลอง race ที่ด่านล็อกกันไม่ได้) — คืนรายการ PAY ของค่าคอมที่ใบอื่นถืออยู่
    const sneaky = {
      compute: async (client: Prisma.TransactionClient, q: SystemRowsQuery): Promise<SystemRowsResult> => {
        const res = await systemRows.compute(client, q);
        return {
          ...res,
          rows: res.rows.map((r) =>
            r.userId !== u
              ? r
              : {
                  ...r,
                  systemIncome: [...r.systemIncome, { source: 'COMMISSION', accountCode: COMMISSION_CODE, name: 'ค่าคอมมิชชัน (1 รายการ)', quantity: null, rate: null, multiplier: null, amount: '1000.00', isTaxable: true }],
                  commissionItems: [
                    { salesCommissionId: c.id, kind: 'PAY', accountCode: COMMISSION_CODE, amount: '1000.00', reference: c.id, date: c.createdAt.toISOString(), reason: null, carriedForward: null },
                  ],
                },
          ),
        };
      },
    };
    const racing = buildCreator(sneaky);
    await expectConflict(createDoc(b2, '2026-10', [line(u)], racing), { code: 'PAYROLL_COMMISSION_TAKEN', message: COMMISSION_TAKEN });
    expect(await prisma.expenseDocument.count({ where: { branchId: b2 } })).toBe(0);

    const other = await createDoc(b2, '2026-10', [line(u)]);
    const before = await lineOf(other.id, u);
    await expectConflict(updateDoc(other.id, '2026-10', [line(u)], racing), { code: 'PAYROLL_COMMISSION_TAKEN', message: COMMISSION_TAKEN });
    expect(await lineOf(other.id, u)).toEqual(before);
    expect(await itemsOfDoc(holder.id)).toEqual(holderItems);
  });
});

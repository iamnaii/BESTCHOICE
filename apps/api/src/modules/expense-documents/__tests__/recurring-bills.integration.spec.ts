import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { addCalendarDays, bkkCalendarDate, periodKeyFor } from '@installment/shared';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { AuditService } from '../../audit/audit.service';
import { ExpenseDocumentCreateService } from '../services/expense-document-create.service';
import { LineAggregatorService } from '../services/line-aggregator.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { SsoConfigService } from '../../sso-config/sso-config.service';
import { PayrollCustomService } from '../services/payroll-custom.service';
import { PettyCashService } from '../services/petty-cash.service';
import { ExpenseDocumentLifecycleService } from '../services/expense-document-lifecycle.service';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../../journal/cpa-templates/expense-accrual.template';
import { ExpenseTemplatesService } from '../expense-templates.service';
import { RecurringBillsService, RULE_CHANGED_REASON, bkkMidnightOf, type RecurringBillActor } from '../recurring-bills/recurring-bills.service';
import { bangkokDateString } from '../../../utils/date.util';

/**
 * ก้อน 6 — บิลประจำ (D5) บนฐานข้อมูลจริง (spec §12, §15) — ทางที่ไม่เคยถูกพิสูจน์มาก่อน:
 * instantiate() → create() จริง · lifecycle.post() จ่ายทันทีจริง · ขั้น B อ่าน paidAt จริง · ตั้งหนี้ (ACCRUAL) ยังไม่จ่าย ·
 * VOID → ถอยกลับ · mark-paid มือ → ลงบัญชี → ปิด · งวดหลุด · สองรอบพร้อมกัน
 * รัน: bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/recurring-bills.integration.spec.ts
 */

const prisma = new PrismaClient();
const journal = new JournalAutoService(prisma as never);
const audit = new AuditService(prisma as never);
let seq = 0;
const docNumber = {
  next: async (_tx: unknown, type: string, date: Date) =>
    `${type === 'EXPENSE' ? 'EX' : type}-${bangkokDateString(date).replace(/-/g, '')}-${String(++seq).padStart(4, '0')}`,
} as never;
const creator = new ExpenseDocumentCreateService(
  prisma as never,
  docNumber,
  new LineAggregatorService(),
  new StatusTransitionService(),
  new SsoConfigService(prisma as never),
  new PayrollCustomService(prisma as never),
  new PettyCashService(prisma as never),
);
const docsFacade = { create: (dto: unknown, userId: string) => creator.create(dto as never, userId) } as never;
const templatesService = new ExpenseTemplatesService(prisma as never, docsFacade);
const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
const bills = new RecurringBillsService(prisma as never, templatesService, notifier, audit);
const lifecycle = new ExpenseDocumentLifecycleService(
  prisma as never,
  new StatusTransitionService(),
  new ExpenseSameDayTemplate(journal, prisma as never),
  new ExpenseAccrualTemplate(journal, prisma as never),
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  journal,
);

const stamp = Date.now();
let branchId: string;
let ownerId: string;
let system: RecurringBillActor;
const owner = (): RecurringBillActor => ({ id: ownerId, branchId: null, role: 'OWNER' });

async function ensureCompany(code: 'SHOP' | 'FINANCE') {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: code, deletedAt: null } });
  if (existing) return;
  await prisma.companyInfo.create({
    data: {
      companyCode: code,
      nameTh: code === 'SHOP' ? 'เบสท์ช้อยส์ ช็อป (ทดสอบ)' : 'เบสท์ช้อยส์ ไฟแนนซ์ (ทดสอบ)',
      taxId: code === 'SHOP' ? '0000000000001' : '0000000000002',
      address: 'ทดสอบ',
      directorName: 'ทดสอบ',
    } as never,
  });
}

async function makeTemplate(over: Record<string, unknown>) {
  return prisma.expenseTemplate.create({
    data: {
      name: `บิลทดสอบ ${stamp}`,
      documentType: 'EXPENSE',
      branchId,
      prefilledData: { vendorName: 'ผู้ขายทดสอบ', category: '53-1302', sampleAmount: 1284, paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201' },
      isRecurring: true,
      recurrence: 'MONTHLY',
      reminderLeadDays: 3,
      createdById: ownerId,
      ...over,
    } as never,
  });
}

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  await ensureCompany('SHOP');
  await ensureCompany('FINANCE');
  const branch = await prisma.branch.create({ data: { name: `สาขาทดสอบบิล ${stamp}` } });
  branchId = branch.id;
  const ownerUser = await prisma.user.create({
    data: { email: `rb-owner-${stamp}@test.local`, password: 'x', name: 'เจ้าของทดสอบ', role: 'OWNER', isActive: true, branchId: null },
  });
  ownerId = ownerUser.id;
  // JournalAutoService โพสต์ JE ในนาม admin@bestchoice.com (resolveSystemUserId) — CI ไม่ seed จึงสร้างเอง
  await prisma.user.upsert({
    where: { email: 'admin@bestchoice.com' },
    update: {},
    create: { email: 'admin@bestchoice.com', password: 'x', name: 'admin (ทดสอบ)', role: 'OWNER', isActive: true },
  });
  const sys =
    (await prisma.user.findFirst({ where: { isSystemUser: true, deletedAt: null } })) ??
    (await prisma.user.create({
      data: { email: `system-${stamp}@bestchoice.internal`, password: '__NO_LOGIN__', name: 'SYSTEM', role: 'OWNER', isActive: false, isSystemUser: true },
    }));
  system = { id: sys.id, branchId: null, role: 'OWNER' };
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('บิลประจำบนฐานข้อมูลจริง', () => {
  it('ขั้น A: ร่างจริงจาก instantiate ลงวันครบกำหนด (เที่ยงวันไทย) + แถวงวด + งาน + แจ้งเตือน → โพสต์จ่ายทันทีจริง → ขั้น B เป็น PAID → VOID → ถอยกลับ PENDING', async () => {
    const now = new Date();
    const today = bkkCalendarDate(now);
    const due = addCalendarDays(today, 2);
    const tpl = await makeTemplate({ recurringDay: due.day, startsOn: bkkMidnightOf(today) });

    const gen = await bills.generateForTemplate(tpl.id, now, system);
    const key = periodKeyFor({ recurrence: 'MONTHLY', recurringDay: due.day, recurringMonth: null }, due);
    expect(gen.created).toEqual([key]);

    const occ = await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { templateId_periodKey: { templateId: tpl.id, periodKey: key } }, include: { expenseDocument: true, todo: true } });
    expect(occ.status).toBe('PENDING');
    expect(occ.dueDate).toEqual(bkkMidnightOf(due));
    expect(String(occ.estimatedAmount)).toBe('1284');
    const doc = occ.expenseDocument!;
    expect(doc.status).toBe('DRAFT');
    expect(doc.fromTemplateId).toBe(tpl.id);
    expect(doc.documentDate.getUTCHours()).toBe(5); // เที่ยงวันไทย
    expect(bkkCalendarDate(doc.documentDate)).toEqual(due);
    expect(doc.number).toMatch(new RegExp(`^EX-${bangkokDateString(doc.documentDate).replace(/-/g, '')}-\\d{4}$`));
    expect(doc.paymentMethod).toBe('BANK_TRANSFER');
    expect(doc.depositAccountCode).toBe('11-1201');
    const lines = await prisma.expenseLine.findMany({ where: { expenseDetailId: doc.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0].category).toBe('53-1302');
    expect(String(lines[0].unitPrice)).toBe('1284');
    expect(occ.todo).toMatchObject({ status: 'TODO', priority: 'MEDIUM', tags: ['recurring-bill', `rb:${occ.id}`], branchId });
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'UPCOMING', occurrenceId: occ.id, documentNumber: doc.number }));

    // โพสต์จ่ายทันทีจริง (OWNER มีสิทธิ์ EXPENSE_POST ครบ · approval_enabled ไม่มีแถว = ปิด)
    await lifecycle.post(doc.id, ownerId, 'OWNER');
    const posted = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(posted.status).toBe('POSTED');
    expect(posted.paidAt).not.toBeNull();

    const sync = await bills.syncOccurrences(now, system);
    expect(sync.paid).toBe(1);
    const afterPay = await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { id: occ.id }, include: { todo: true } });
    expect(afterPay.status).toBe('PAID');
    expect(afterPay.paidById).toBeNull();
    expect(afterPay.todo?.status).toBe('DONE');

    // ใบถูกยกเลิก → ระบบเปิดงวดกลับเอง (ขั้น B ข้อ 5)
    await prisma.expenseDocument.update({ where: { id: doc.id }, data: { status: 'VOIDED' } });
    const sync2 = await bills.syncOccurrences(now, system);
    expect(sync2.reverted).toBe(1);
    const afterVoid = await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { id: occ.id }, include: { todo: true } });
    expect(afterVoid.status).toBe('PENDING');
    expect(afterVoid.todo?.status).toBe('TODO');
  }, 60_000);

  it('ไม่มีวิธีจ่ายในแม่แบบ → ร่างโพสต์เป็นตั้งหนี้ (ACCRUAL, paidAt ว่าง) → งวดยัง PENDING · mark-paid มือ → PAID_UNPOSTED → ใบจ่ายแล้ว → งานปิด', async () => {
    const now = new Date();
    const today = bkkCalendarDate(now);
    const due = addCalendarDays(today, 1);
    const tpl = await makeTemplate({
      name: `ค่าเช่าตั้งหนี้ ${stamp}`,
      recurringDay: due.day,
      startsOn: bkkMidnightOf(today),
      prefilledData: { vendorName: 'เจ้าของตึก', category: '53-1302', sampleAmount: 5000 },
    });
    await bills.generateForTemplate(tpl.id, now, system);
    const key = periodKeyFor({ recurrence: 'MONTHLY', recurringDay: due.day, recurringMonth: null }, due);
    const occ = await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { templateId_periodKey: { templateId: tpl.id, periodKey: key } } });
    expect(occ.expenseDocumentId).not.toBeNull();

    await lifecycle.post(occ.expenseDocumentId!, ownerId, 'OWNER');
    const accrued = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: occ.expenseDocumentId! } });
    expect(accrued.status).toBe('ACCRUAL');
    expect(accrued.paidAt).toBeNull();

    await bills.syncOccurrences(now, system);
    const still = await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
    expect(still.status).toBe('PENDING');
    const view = await bills.listMonth(owner(), `${due.year}-${String(due.month).padStart(2, '0')}`, undefined, now);
    const row = view.rows.find((r) => r.occurrenceId === occ.id)!;
    expect(row.document?.status).toBe('ACCRUAL');
    expect(row.paymentConfigured).toBe(false);

    await bills.markPaid(occ.id, owner(), { note: 'ตัดบัตรอัตโนมัติ' }, now);
    const view2 = await bills.listMonth(owner(), `${due.year}-${String(due.month).padStart(2, '0')}`, undefined, now);
    expect(view2.rows.find((r) => r.occurrenceId === occ.id)!.status).toBe('PAID_UNPOSTED');
    const todo = await prisma.todo.findFirstOrThrow({ where: { tags: { hasEvery: ['recurring-bill', `rb:${occ.id}`] } } });
    expect(todo.status).toBe('TODO');
    expect(todo.title).toMatch(/^ลงบัญชีใบ EX-/);

    // ใบจ่ายเจ้าหนี้ล้างครบ → ใบ EX เป็น POSTED + paidAt (จำลองผลลัพธ์ของ vendor-settlement)
    await prisma.expenseDocument.update({ where: { id: occ.expenseDocumentId! }, data: { status: 'POSTED', paidAt: now } });
    const sync = await bills.syncOccurrences(now, system);
    expect(sync.unpostedClosed).toBe(1);
    const closed = await prisma.todo.findUniqueOrThrow({ where: { id: todo.id } });
    expect(closed.status).toBe('DONE');
    const view3 = await bills.listMonth(owner(), `${due.year}-${String(due.month).padStart(2, '0')}`, undefined, now);
    expect(view3.rows.find((r) => r.occurrenceId === occ.id)!.status).toBe('PAID');
  }, 60_000);

  it('งวดหลุดเกิน 7 วัน → SKIPPED ระบบ + งาน "งวดหลุด" ไม่มีร่าง · สอง generate พร้อมกัน → แถวเดียว งานเดียว', async () => {
    const now = new Date();
    const today = bkkCalendarDate(now);
    const missedDue = addCalendarDays(today, -10);
    const tpl = await makeTemplate({ name: `บิลหลุด ${stamp}`, recurringDay: missedDue.day, startsOn: bkkMidnightOf(addCalendarDays(today, -40)) });
    const res = await bills.generateForTemplate(tpl.id, now, system);
    const missedKey = periodKeyFor({ recurrence: 'MONTHLY', recurringDay: missedDue.day, recurringMonth: null }, missedDue);
    expect(res.skippedMissed).toContain(missedKey);
    const missed = await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { templateId_periodKey: { templateId: tpl.id, periodKey: missedKey } }, include: { todo: true } });
    expect(missed).toMatchObject({ status: 'SKIPPED', skippedById: null, skipReason: 'งวดผ่านไปก่อนระบบเริ่มติดตาม', expenseDocumentId: null });
    expect(missed.todo?.title).toMatch(/^งวดหลุด/);

    const dueSoon = addCalendarDays(today, 2);
    const tpl2 = await makeTemplate({ name: `บิลซ้อน ${stamp}`, recurringDay: dueSoon.day, startsOn: bkkMidnightOf(today) });
    const [a, b] = await Promise.all([bills.generateForTemplate(tpl2.id, now, system), bills.generateForTemplate(tpl2.id, now, system)]);
    expect(a.created.length + b.created.length).toBe(1);
    const rows = await prisma.recurringBillOccurrence.findMany({ where: { templateId: tpl2.id } });
    expect(rows).toHaveLength(1);
    const todos = await prisma.todo.findMany({ where: { tags: { hasEvery: ['recurring-bill', `rb:${rows[0].id}`] } } });
    expect(todos).toHaveLength(1);
  }, 60_000);

  it('แก้วันครบกำหนดหลังมีงวดแล้ว (25 → 28 ในเดือนเดียวกัน): งวดเดิมถูกปิด "แม่แบบเปลี่ยนรอบ" แล้วฟื้นด้วยวันใหม่ ไม่หายเงียบ (รีวิว C1)', async () => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day, 1, 5)); // 08:05 ไทย ต.ค. 2569
    const tpl = await makeTemplate({ name: `ค่าเช่าโกดัง-C1 ${stamp}`, recurringDay: 25, startsOn: bkkMidnightOf({ year: 2026, month: 10, day: 20 }) });
    const first = await bills.generateForTemplate(tpl.id, at(22), system);
    expect(first.created).toEqual(['2026-10']);
    const before = await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { templateId_periodKey: { templateId: tpl.id, periodKey: '2026-10' } } });
    expect(before.dueDate).toEqual(bkkMidnightOf({ year: 2026, month: 10, day: 25 }));
    const oldDocId = before.expenseDocumentId!;
    // 23 ต.ค. แก้เป็นวันที่ 28 — ลำดับเดียวกับ controller: update แม่แบบ → retire → generate
    await prisma.expenseTemplate.update({ where: { id: tpl.id }, data: { recurringDay: 28, startsOn: bkkMidnightOf({ year: 2026, month: 10, day: 23 }) } });
    expect((await bills.retireOpenOccurrences(tpl.id, RULE_CHANGED_REASON, owner(), at(23))).retired).toBe(1);
    expect((await bills.generateForTemplate(tpl.id, at(23), owner())).revived).toEqual([]); // หน้าต่างของวันที่ 28 เปิด 25 ต.ค.
    const gen = await bills.generateForTemplate(tpl.id, at(26), system);
    expect(gen.revived).toEqual(['2026-10']);
    expect(gen.created).toEqual([]);
    const after = await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { id: before.id }, include: { expenseDocument: true, todo: true } });
    expect(after).toMatchObject({ status: 'PENDING', skippedById: null, skipReason: null, dueDate: bkkMidnightOf({ year: 2026, month: 10, day: 28 }) });
    expect(after.expenseDocument!.id).not.toBe(oldDocId);
    expect(after.expenseDocument!.deletedAt).toBeNull();
    expect(bkkCalendarDate(after.expenseDocument!.documentDate)).toEqual({ year: 2026, month: 10, day: 28 });
    expect((await prisma.expenseDocument.findUniqueOrThrow({ where: { id: oldDocId } })).deletedAt).not.toBeNull();
    expect(after.todo).toMatchObject({ id: before.todoId, status: 'TODO' });
  }, 60_000);

  it('สองคนกด "สร้างร่างใหม่" พร้อมกัน → ได้ร่างเดียว อีกคน 409 และร่างที่แพ้ถูกลบ (รีวิว I1)', async () => {
    const now = new Date();
    const today = bkkCalendarDate(now);
    const due = addCalendarDays(today, 2);
    const tpl = await makeTemplate({ name: `บิลแข่ง ${stamp}`, recurringDay: due.day, startsOn: bkkMidnightOf(today) });
    await bills.generateForTemplate(tpl.id, now, system);
    const occ = await prisma.recurringBillOccurrence.findFirstOrThrow({ where: { templateId: tpl.id } });
    await prisma.expenseDocument.update({ where: { id: occ.expenseDocumentId! }, data: { deletedAt: now } }); // ร่างถูกลบไป
    const results = await Promise.allSettled([bills.createDraft(occ.id, owner(), now), bills.createDraft(occ.id, owner(), now)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const live = await prisma.expenseDocument.findMany({ where: { fromTemplateId: tpl.id, deletedAt: null } });
    expect(live).toHaveLength(1);
    expect((await prisma.recurringBillOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).expenseDocumentId).toBe(live[0].id);
  }, 60_000);
});

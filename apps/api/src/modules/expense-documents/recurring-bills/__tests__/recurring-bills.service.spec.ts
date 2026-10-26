import * as Sentry from '@sentry/nestjs';
import { RecurringBillsService } from '../recurring-bills.service';
import {
  LoggingRecurringBillNotifier,
  buildRecurringBillMessage,
  type RecurringBillEvent,
} from '../recurring-bill-notifier';
import { viewStatusOf } from '../recurring-bill-view.util';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

// 08:05 Asia/Bangkok on Mon 26 Oct 2026
const NOW = new Date('2026-10-26T01:05:00.000Z');
const SYSTEM = { id: 'sys-1', branchId: null, role: 'OWNER' };
const bkkMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d) - 7 * 3600_000);
const bkkNoon = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 5));
const dateOnly = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

function template(over: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'อินเทอร์เน็ต AIS Fibre',
    documentType: 'EXPENSE',
    branchId: 'br-1',
    isRecurring: true,
    recurrence: 'MONTHLY',
    recurringDay: 28,
    recurringMonth: null,
    reminderLeadDays: 3,
    startsOn: bkkMidnight(2026, 10, 26),
    createdAt: new Date('2026-10-26T00:00:00Z'),
    deletedAt: null,
    prefilledData: { vendorName: 'บมจ.แอดวานซ์', category: 'S52-1104', sampleAmount: 1284 },
    branch: { name: 'ลาดพร้าว' },
    ...over,
  };
}

function occurrence(over: Record<string, unknown> = {}) {
  return {
    id: 'occ-1',
    templateId: 'tpl-1',
    periodKey: '2026-10',
    dueDate: bkkMidnight(2026, 10, 24),
    status: 'PENDING',
    estimatedAmount: '1284',
    expenseDocumentId: 'doc-1',
    todoId: 'todo-1',
    paidAt: null,
    paidById: null,
    lastRemindedOn: null,
    template: template({ recurringDay: 24 }),
    expenseDocument: {
      id: 'doc-1',
      number: 'EX-20261021-0002',
      status: 'DRAFT',
      paidAt: null,
      deletedAt: null,
      documentDate: bkkNoon(2026, 10, 24),
      createdById: SYSTEM.id,
    },
    todo: { id: 'todo-1', status: 'TODO', deletedAt: null, title: 'x' },
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let templates: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notifier: any;
let service: RecurringBillsService;

beforeEach(() => {
  jest.clearAllMocks();
  prisma = {
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findFirst: jest.fn().mockResolvedValue(SYSTEM), findMany: jest.fn().mockResolvedValue([]) },
    expenseTemplate: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(template()) },
    recurringBillOccurrence: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'occ-1', ...data })),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    expenseDocument: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    todo: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'todo-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    ),
  };
  templates = { instantiate: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20261028-0001' }) };
  notifier = { notify: jest.fn().mockResolvedValue(undefined) };
  service = new RecurringBillsService(prisma, templates, notifier);
});

describe('generateForTemplate (ขั้น A)', () => {
  it('A1 creates the October occurrence, the draft dated noon of the due day, one todo and an UPCOMING notice', async () => {
    const res = await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(res.created).toEqual(['2026-10']);
    const createArg = prisma.recurringBillOccurrence.create.mock.calls[0][0].data;
    expect(createArg).toMatchObject({ templateId: 'tpl-1', periodKey: '2026-10', status: 'PENDING', dueDate: bkkMidnight(2026, 10, 28) });
    expect(String(createArg.estimatedAmount)).toBe('1284');
    expect(templates.instantiate).toHaveBeenCalledWith('tpl-1', SYSTEM, { documentDate: bkkNoon(2026, 10, 28) });
    expect(prisma.recurringBillOccurrence.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'occ-1' }, data: { expenseDocumentId: 'doc-1' } }));
    const todo = prisma.todo.create.mock.calls[0][0].data;
    expect(todo.title).toBe('บิลประจำ: อินเทอร์เน็ต AIS Fibre (ลาดพร้าว) · ครบกำหนด 28 ต.ค. 69');
    expect(todo).toMatchObject({ priority: 'MEDIUM', tags: ['recurring-bill', 'rb:occ-1'], branchId: 'br-1', createdById: 'sys-1', dueDate: bkkNoon(2026, 10, 28) });
    expect(todo.description).toContain('EX-20261028-0001');
    expect(todo.description).toContain('/expenses/recurring-bills?month=2026-10');
    expect(prisma.recurringBillOccurrence.update).toHaveBeenCalledWith(expect.objectContaining({ data: { todoId: 'todo-1' } }));
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'UPCOMING', occurrenceId: 'occ-1', documentNumber: 'EX-20261028-0001', daysOverdue: -2 }));
  });

  it('A2 is idempotent — an existing row for the period creates nothing', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([{ periodKey: '2026-10' }]);
    const res = await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(res.created).toEqual([]);
    expect(prisma.recurringBillOccurrence.create).not.toHaveBeenCalled();
    expect(templates.instantiate).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('A3 a due day already passed before startsOn is not created, and the next period is outside the window', async () => {
    prisma.expenseTemplate.findUnique.mockResolvedValue(template({ recurringDay: 25 }));
    const res = await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(res.created).toEqual([]);
    expect(res.skippedMissed).toEqual([]);
    expect(prisma.recurringBillOccurrence.create).not.toHaveBeenCalled();
  });

  it('A3b a bill created on its own due day counts today (startsOn compared by Thai calendar day)', async () => {
    prisma.expenseTemplate.findUnique.mockResolvedValue(template({ recurringDay: 26 }));
    const res = await service.generateForTemplate('tpl-1', new Date('2026-10-26T07:00:00Z'), SYSTEM);
    expect(res.created).toEqual(['2026-10']);
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'DUE_TODAY' }));
    const createArg = prisma.recurringBillOccurrence.create.mock.calls[0][0].data;
    expect(createArg.lastRemindedOn).toEqual(dateOnly(2026, 10, 26));
  });

  it('A4 catch-up: only the period just before the 7-day floor becomes SKIPPED(system)+todo, the current one PENDING, older ones untouched', async () => {
    prisma.expenseTemplate.findUnique.mockResolvedValue(template({ startsOn: bkkMidnight(2026, 8, 1) }));
    let n = 0;
    prisma.recurringBillOccurrence.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: `occ-${++n}`, ...data }));
    const res = await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(res.skippedMissed).toEqual(['2026-09']);
    expect(res.created).toEqual(['2026-10']);
    const sept = prisma.recurringBillOccurrence.create.mock.calls[0][0].data;
    expect(sept).toMatchObject({ periodKey: '2026-09', status: 'SKIPPED', skippedById: null, skipReason: 'งวดผ่านไปก่อนระบบเริ่มติดตาม' });
    expect(templates.instantiate).toHaveBeenCalledTimes(1); // October only
    const titles = prisma.todo.create.mock.calls.map((c: { 0: { data: { title: string } } }) => c[0].data.title);
    expect(titles[0]).toMatch(/^งวดหลุด — ตรวจว่าจ่ายแล้วหรือยัง: อินเทอร์เน็ต AIS Fibre ครบ 28 ก\.ย\. 69/);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
  });

  it('A5 draft creation failure keeps the occurrence, still creates a todo that says so, and reports to Sentry', async () => {
    templates.instantiate.mockRejectedValue(new Error('validation'));
    const res = await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(res.created).toEqual(['2026-10']);
    expect(prisma.recurringBillOccurrence.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expenseDocumentId: expect.anything() }) }));
    expect(prisma.todo.create.mock.calls[0][0].data.description).toContain('สร้างร่างไม่สำเร็จ');
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('A6 reuses an own draft already dated on the due day instead of creating a second one (never a human QuickStart draft)', async () => {
    prisma.expenseDocument.findFirst.mockResolvedValue({ id: 'doc-x', number: 'EX-X' });
    await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(templates.instantiate).not.toHaveBeenCalled();
    const where = prisma.expenseDocument.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ fromTemplateId: 'tpl-1', createdById: 'sys-1', recurringBillOccurrence: null, deletedAt: null });
    expect(where.documentDate).toEqual({ gte: bkkMidnight(2026, 10, 28), lt: bkkMidnight(2026, 10, 29) });
    expect(prisma.recurringBillOccurrence.update).toHaveBeenCalledWith(expect.objectContaining({ data: { expenseDocumentId: 'doc-x' } }));
  });

  it('A9 a P2002 on create (another instance won) counts as skippedExisting, not failed', async () => {
    prisma.recurringBillOccurrence.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const res = await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(res.created).toEqual([]);
    expect(res.skippedExisting).toBe(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('ignores deleted / non-recurring / non-EXPENSE templates', async () => {
    prisma.expenseTemplate.findUnique.mockResolvedValue(template({ documentType: 'PAYROLL' }));
    expect((await service.generateForTemplate('tpl-1', NOW, SYSTEM)).created).toEqual([]);
    prisma.expenseTemplate.findUnique.mockResolvedValue(template({ deletedAt: new Date() }));
    expect((await service.generateForTemplate('tpl-1', NOW, SYSTEM)).created).toEqual([]);
    expect(prisma.recurringBillOccurrence.create).not.toHaveBeenCalled();
  });
});

describe('syncOccurrences (ขั้น B)', () => {
  it('B1 linked document POSTED+paidAt → PAID (CAS on PENDING), todo closed', async () => {
    const paidAt = bkkNoon(2026, 10, 24);
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence({ expenseDocument: { id: 'doc-1', number: 'EX-1', status: 'POSTED', paidAt, deletedAt: null, documentDate: paidAt, createdById: 'sys-1' } })]);
    const res = await service.syncOccurrences(NOW, SYSTEM);
    expect(res.paid).toBe(1);
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', status: 'PENDING' }, data: { status: 'PAID', paidAt, paidById: null, expenseDocumentId: 'doc-1' } });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'todo-1' }), data: expect.objectContaining({ status: 'DONE' }) }));
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('B2 an unlinked paid document from the same template inside the period window is linked; the system draft is soft-deleted with an audit row', async () => {
    const paidAt = bkkNoon(2026, 10, 22);
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence()]);
    prisma.expenseDocument.findFirst.mockResolvedValue({ id: 'doc-9', number: 'EX-9', status: 'POSTED', paidAt, deletedAt: null, documentDate: paidAt, createdById: 'u-acc' });
    const res = await service.syncOccurrences(NOW, SYSTEM);
    expect(res.paid).toBe(1);
    const where = prisma.expenseDocument.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ fromTemplateId: 'tpl-1', recurringBillOccurrence: null, deletedAt: null, status: 'POSTED', paidAt: { not: null } });
    expect(where.documentDate).toEqual({ gte: bkkMidnight(2026, 10, 21), lt: bkkMidnight(2026, 11, 21) });
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID', expenseDocumentId: 'doc-9' }) }));
    expect(prisma.expenseDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doc-1', status: 'DRAFT', deletedAt: null } }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'DELETED', entity: 'expense_document', entityId: 'doc-1', userId: 'sys-1' }) }));
  });

  it('B3 a system-paid occurrence whose document was voided reverts to PENDING and reopens the todo', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence({ status: 'PAID', paidAt: bkkNoon(2026, 10, 24), expenseDocument: { id: 'doc-1', number: 'EX-1', status: 'VOIDED', paidAt: bkkNoon(2026, 10, 24), deletedAt: null, documentDate: bkkNoon(2026, 10, 24), createdById: 'sys-1' }, todo: { id: 'todo-1', status: 'DONE', deletedAt: null } })]);
    const res = await service.syncOccurrences(NOW, SYSTEM);
    expect(res.reverted).toBe(1);
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', status: 'PAID', paidById: null }, data: { status: 'PENDING', paidAt: null } });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'TODO', completedAt: null }) }));
  });

  it('B4 manually paid but document not posted → todo becomes "ลงบัญชีใบ …" (HIGH once due), no LINE; once the document is paid the todo closes', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence({ status: 'PAID', paidById: 'u-acc', paidAt: bkkNoon(2026, 10, 14) })]);
    let res = await service.syncOccurrences(NOW, SYSTEM);
    const upd = prisma.todo.updateMany.mock.calls.find((c: { 0: { data: { title?: string } } }) => c[0].data.title?.startsWith('ลงบัญชีใบ EX-20261021-0002'));
    expect(upd).toBeDefined();
    expect(upd[0].data.priority).toBe('HIGH');
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(res.unpostedClosed).toBe(0);

    jest.clearAllMocks();
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence({ status: 'PAID', paidById: 'u-acc', paidAt: bkkNoon(2026, 10, 14), expenseDocument: { id: 'doc-1', number: 'EX-1', status: 'POSTED', paidAt: bkkNoon(2026, 10, 25), deletedAt: null, documentDate: bkkNoon(2026, 10, 25), createdById: 'u-acc' } })]);
    res = await service.syncOccurrences(NOW, SYSTEM);
    expect(res.unpostedClosed).toBe(1);
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DONE' }) }));
    expect(prisma.recurringBillOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('B5 due today → CAS on lastRemindedOn, todo HIGH "ครบกำหนดวันนี้", DUE_TODAY notice once', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence({ dueDate: bkkMidnight(2026, 10, 26) })]);
    const res = await service.syncOccurrences(NOW, SYSTEM);
    expect(res.reminded).toBe(1);
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({
      where: { id: 'occ-1', status: 'PENDING', OR: [{ lastRemindedOn: null }, { lastRemindedOn: { lt: dateOnly(2026, 10, 26) } }] },
      data: { lastRemindedOn: dateOnly(2026, 10, 26) },
    });
    const upd = prisma.todo.updateMany.mock.calls.find((c: { 0: { data: { title?: string } } }) => c[0].data.title);
    expect(upd[0].data.title).toContain('ครบกำหนดวันนี้');
    expect(upd[0].data.priority).toBe('HIGH');
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'DUE_TODAY', daysOverdue: 0 }));
  });

  it('B6 overdue by 2 days → "เกินกำหนด 2 วัน" + OVERDUE notice; B12 CAS count 0 → nothing', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence()]);
    await service.syncOccurrences(NOW, SYSTEM);
    const upd = prisma.todo.updateMany.mock.calls.find((c: { 0: { data: { title?: string } } }) => c[0].data.title);
    expect(upd[0].data.title).toContain('เกินกำหนด 2 วัน');
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'OVERDUE', daysOverdue: 2 }));

    jest.clearAllMocks();
    prisma.recurringBillOccurrence.updateMany.mockResolvedValue({ count: 0 });
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence()]);
    const res = await service.syncOccurrences(NOW, SYSTEM);
    expect(res.reminded).toBe(0);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('B7 a todo deleted by a human is never recreated; B13 a never-created todo (todoId null, no tagged row) is created once with an UPCOMING notice', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence({ dueDate: bkkMidnight(2026, 10, 29), todo: null })]);
    prisma.todo.findFirst.mockResolvedValue({ id: 'todo-old', deletedAt: new Date(), status: 'TODO' });
    await service.syncOccurrences(NOW, SYSTEM);
    expect(prisma.todo.create).not.toHaveBeenCalled();

    jest.clearAllMocks();
    prisma.todo.findFirst.mockResolvedValue(null);
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence({ dueDate: bkkMidnight(2026, 10, 29), todoId: null, todo: null })]);
    await service.syncOccurrences(NOW, SYSTEM);
    expect(prisma.todo.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tags: { hasEvery: ['recurring-bill', 'rb:occ-1'] } } }));
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
    expect(prisma.recurringBillOccurrence.update).toHaveBeenCalledWith(expect.objectContaining({ data: { todoId: 'todo-1' } }));
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'UPCOMING' }));
  });

  it('B14 a row whose template was deleted still gets reminders (no crash)', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([occurrence({ template: template({ recurringDay: 24, deletedAt: new Date() }) })]);
    const res = await service.syncOccurrences(NOW, SYSTEM);
    expect(res.failed).toBe(0);
    expect(res.reminded).toBe(1);
  });
});

describe('runDaily', () => {
  it('B8 templates_enabled=false → disabled, touches nothing', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
    const res = await service.runDaily(NOW);
    expect(res.disabled).toBe(true);
    expect(prisma.expenseTemplate.findMany).not.toHaveBeenCalled();
    expect(prisma.recurringBillOccurrence.findMany).not.toHaveBeenCalled();
  });

  it('B9 no system user → Sentry message, zero work', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const res = await service.runDaily(NOW);
    expect(res.disabled).toBe(false);
    expect(res.created).toBe(0);
    expect(Sentry.captureMessage).toHaveBeenCalled();
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { isSystemUser: true, deletedAt: null } }));
    expect(prisma.expenseTemplate.findMany).not.toHaveBeenCalled();
  });

  it('runs step A for every live recurring EXPENSE template then step B', async () => {
    prisma.expenseTemplate.findMany.mockResolvedValue([{ id: 'tpl-1' }, { id: 'tpl-2' }]);
    const res = await service.runDaily(NOW);
    expect(prisma.expenseTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isRecurring: true, recurrence: { not: null }, documentType: 'EXPENSE', deletedAt: null } }));
    expect(prisma.expenseTemplate.findUnique).toHaveBeenCalledTimes(2);
    expect(res.created).toBe(2);
    expect(prisma.recurringBillOccurrence.findMany).toHaveBeenCalled();
  });
});

describe('notifier + view status', () => {
  const event: RecurringBillEvent = {
    kind: 'OVERDUE', occurrenceId: 'occ-1', templateName: 'อินเทอร์เน็ต AIS Fibre', vendorName: 'บมจ.แอดวานซ์',
    branchName: 'ลาดพร้าว', dueDate: { year: 2026, month: 10, day: 24 }, daysOverdue: 2, amount: '1284', documentNumber: 'EX-20261021-0002',
    link: 'https://app.example/expenses/recurring-bills?month=2026-10',
  };
  it('N1 builds the 5-line Thai message for each kind', () => {
    expect(buildRecurringBillMessage(event)).toBe(
      '[บิลประจำ] เกินกำหนด 2 วัน\nอินเทอร์เน็ต AIS Fibre (ลาดพร้าว)\nครบกำหนด 24 ต.ค. 69 · ยอดประมาณ 1,284 บาท\nร่างใบรายจ่าย EX-20261021-0002 รอจ่าย\nเปิดหน้าบิลประจำ: https://app.example/expenses/recurring-bills?month=2026-10',
    );
    expect(buildRecurringBillMessage({ ...event, kind: 'DUE_TODAY', daysOverdue: 0 }).split('\n')[0]).toBe('[บิลประจำ] ครบกำหนดวันนี้');
    expect(buildRecurringBillMessage({ ...event, kind: 'UPCOMING', daysOverdue: -3, documentNumber: null, amount: null }).split('\n')).toEqual(
      expect.arrayContaining(['[บิลประจำ] ครบกำหนดใน 3 วัน', 'ครบกำหนด 24 ต.ค. 69 · ยอดประมาณ —', 'ยังไม่มีร่างใบรายจ่าย']),
    );
  });
  it('N2 recipients = active, non-system OWNER/ACCOUNTANT only; the stub only logs', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'a@b' }]);
    const stub = new LoggingRecurringBillNotifier(prisma);
    await stub.notify(event);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true, deletedAt: null, isSystemUser: false, role: { in: ['OWNER', 'ACCOUNTANT'] } } }));
  });
  it('viewStatusOf derives the 7 states', () => {
    const today = { year: 2026, month: 10, day: 26 };
    const doc = (status: string, paidAt: Date | null) => ({ status, paidAt, deletedAt: null });
    expect(viewStatusOf({ status: 'SKIPPED', paidById: null, dueDate: bkkMidnight(2026, 10, 5) }, null, today)).toBe('SKIPPED');
    expect(viewStatusOf({ status: 'PAID', paidById: null, dueDate: bkkMidnight(2026, 10, 1) }, doc('POSTED', NOW), today)).toBe('PAID');
    expect(viewStatusOf({ status: 'PAID', paidById: 'u', dueDate: bkkMidnight(2026, 10, 15) }, doc('DRAFT', null), today)).toBe('PAID_UNPOSTED');
    expect(viewStatusOf({ status: 'PAID', paidById: 'u', dueDate: bkkMidnight(2026, 10, 15) }, doc('POSTED', NOW), today)).toBe('PAID');
    expect(viewStatusOf({ status: 'PENDING', paidById: null, dueDate: bkkMidnight(2026, 10, 24) }, null, today)).toBe('OVERDUE');
    expect(viewStatusOf({ status: 'PENDING', paidById: null, dueDate: bkkMidnight(2026, 10, 26) }, null, today)).toBe('DUE_TODAY');
    expect(viewStatusOf({ status: 'PENDING', paidById: null, dueDate: bkkMidnight(2026, 10, 29) }, null, today)).toBe('PENDING');
  });
});

describe('retireOpenOccurrences (แม่แบบเปลี่ยนรอบ — §15.5)', () => {
  it('skips every PENDING occurrence whose document is not paid, closes its todo and deletes the system draft', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([
      occurrence({ id: 'occ-a' }),
      occurrence({ id: 'occ-b', todoId: null, todo: null, expenseDocumentId: null, expenseDocument: null }),
      occurrence({ id: 'occ-c', expenseDocument: { id: 'doc-c', number: 'EX-C', status: 'POSTED', paidAt: NOW, deletedAt: null, documentDate: NOW, createdById: 'u' } }),
    ]);
    const res = await service.retireOpenOccurrences('tpl-1', 'แม่แบบเปลี่ยนรอบ', SYSTEM, NOW);
    expect(res.retired).toBe(2);
    expect(prisma.recurringBillOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { templateId: 'tpl-1', status: 'PENDING' } }));
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-a', status: 'PENDING' }, data: { status: 'SKIPPED', skippedAt: NOW, skippedById: null, skipReason: 'แม่แบบเปลี่ยนรอบ' } });
    expect(prisma.recurringBillOccurrence.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'occ-c', status: 'PENDING' } }));
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'todo-1' }), data: expect.objectContaining({ status: 'DONE' }) }));
    expect(prisma.expenseDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doc-1', status: 'DRAFT', deletedAt: null } }));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

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
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', expenseDocumentId: null }, data: { expenseDocumentId: 'doc-1' } }); // CAS กันผูกซ้ำ (รีวิว I1)
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
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', expenseDocumentId: null }, data: { expenseDocumentId: 'doc-x' } }); // CAS (รีวิว I1)
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
    branchName: 'ลาดพร้าว', branchId: 'br-1', dueDate: { year: 2026, month: 10, day: 24 }, daysOverdue: 2, amount: '1284', documentNumber: 'EX-20261021-0002',
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

describe('retireOpenOccurrences (แม่แบบเปลี่ยนรอบ — §15.5 · รีวิว C1)', () => {
  it('skips only PENDING occurrences not yet due whose document is still a draft (or missing); overdue / due-today / progressed / paid rows stay', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([
      occurrence({ id: 'occ-a', dueDate: bkkMidnight(2026, 10, 28) }),
      occurrence({ id: 'occ-b', dueDate: bkkMidnight(2026, 10, 30), todoId: null, todo: null, expenseDocumentId: null, expenseDocument: null }),
      occurrence({ id: 'occ-c', dueDate: bkkMidnight(2026, 10, 28), expenseDocument: { id: 'doc-c', number: 'EX-C', status: 'POSTED', paidAt: NOW, deletedAt: null, documentDate: NOW, createdById: 'u' } }),
      occurrence({ id: 'occ-d' }), // ครบกำหนด 24 ต.ค. = เกินกำหนดแล้ว — คนยังต้องจ่ายบิลนี้
      occurrence({ id: 'occ-e', dueDate: bkkMidnight(2026, 10, 29), expenseDocument: { id: 'doc-e', number: 'EX-E', status: 'ACCRUAL', paidAt: null, deletedAt: null, documentDate: NOW, createdById: 'u' } }),
      occurrence({ id: 'occ-f', dueDate: bkkMidnight(2026, 10, 26) }), // ครบกำหนดวันนี้ — ปล่อยไว้
    ]);
    const res = await service.retireOpenOccurrences('tpl-1', 'แม่แบบเปลี่ยนรอบ', SYSTEM, NOW);
    expect(res.retired).toBe(2);
    const retiredIds = prisma.recurringBillOccurrence.updateMany.mock.calls.map((c: [{ where: { id: string } }]) => c[0].where.id);
    expect([...retiredIds].sort()).toEqual(['occ-a', 'occ-b']);
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-a', status: 'PENDING' }, data: { status: 'SKIPPED', skippedAt: NOW, skippedById: null, skipReason: 'แม่แบบเปลี่ยนรอบ' } });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'todo-1' }), data: expect.objectContaining({ status: 'DONE' }) }));
    expect(prisma.expenseDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doc-1', status: 'DRAFT', deletedAt: null } }));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('generateForTemplate after a rule change (รีวิว C1 · Review Focus #1)', () => {
  it('A10 revives the period the rule change retired under the same key: new dueDate, new draft, todo back to TODO, UPCOMING notice', async () => {
    // 22 ต.ค. สร้างงวด 2026-10 (วันที่ 25) · 23 ต.ค. แก้เป็นวันที่ 28 → แถวเดิมถูกปิด "แม่แบบเปลี่ยนรอบ" · 26 ต.ค. หน้าต่างของวันที่ 28 เปิด
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([
      { id: 'occ-r', periodKey: '2026-10', status: 'SKIPPED', skippedById: null, skipReason: 'แม่แบบเปลี่ยนรอบ', dueDate: bkkMidnight(2026, 10, 25), todoId: 'todo-r', expenseDocumentId: 'doc-old' },
    ]);
    const res = await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(res.revived).toEqual(['2026-10']);
    expect(res.created).toEqual([]);
    expect(prisma.recurringBillOccurrence.create).not.toHaveBeenCalled();
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({
      where: { id: 'occ-r', status: 'SKIPPED', skippedById: null, skipReason: 'แม่แบบเปลี่ยนรอบ' },
      data: expect.objectContaining({ status: 'PENDING', dueDate: bkkMidnight(2026, 10, 28), skippedAt: null, skippedById: null, skipReason: null, lastRemindedOn: null }),
    });
    expect(templates.instantiate).toHaveBeenCalledWith('tpl-1', SYSTEM, { documentDate: bkkNoon(2026, 10, 28) });
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-r', expenseDocumentId: 'doc-old' }, data: { expenseDocumentId: 'doc-1' } });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'todo-r' }), data: expect.objectContaining({ status: 'TODO', completedAt: null, dueDate: bkkNoon(2026, 10, 28), priority: 'MEDIUM' }) }));
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'UPCOMING', occurrenceId: 'occ-r', daysOverdue: -2 }));
  });

  it('A11 a period the rule change left alone (already due, still PENDING) is neither re-created nor revived', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([
      { id: 'occ-p', periodKey: '2026-10', status: 'PENDING', skippedById: null, skipReason: null, dueDate: bkkMidnight(2026, 10, 24), todoId: 'todo-p', expenseDocumentId: 'doc-p' },
    ]);
    const res = await service.generateForTemplate('tpl-1', NOW, SYSTEM);
    expect(res).toEqual({ created: [], revived: [], skippedMissed: [], skippedExisting: 0 });
    expect(prisma.recurringBillOccurrence.create).not.toHaveBeenCalled();
    expect(prisma.recurringBillOccurrence.updateMany).not.toHaveBeenCalled();
  });
});

// ─── Task 6: มุมมองรายเดือน + การกระทำ (spec §8, §15.2, §15.5) ──────────────────────────
describe('listMonth', () => {
  const ACC = { id: 'u-acc', branchId: null, role: 'ACCOUNTANT' };
  const BM = { id: 'u-bm', branchId: 'br-1', role: 'BRANCH_MANAGER' };
  const paidDoc = (id: string, number: string, paidAt: Date) => ({ id, number, status: 'POSTED', paidAt, deletedAt: null, documentDate: paidAt, createdById: 'u', totalAmount: '25000' });
  const draftDoc = (id: string, number: string) => ({ id, number, status: 'DRAFT', paidAt: null, deletedAt: null, documentDate: NOW, createdById: 'sys-1', totalAmount: '0.01' });

  function monthFixture() {
    const rent = template({ id: 'tpl-rent', name: 'ค่าเช่าร้าน', recurringDay: 1, prefilledData: { vendorName: 'พลาซ่า', sampleAmount: 25000 } });
    const elec = template({ id: 'tpl-elec', name: 'ค่าไฟ', recurringDay: 15, prefilledData: { vendorName: 'กฟน.', sampleAmount: 8500 } });
    const net = template({ id: 'tpl-net', name: 'อินเทอร์เน็ต', recurringDay: 24 });
    const wh = template({ id: 'tpl-wh', name: 'ค่าเช่าโกดัง', recurringDay: 26, branchId: 'br-2', branch: { name: 'บางนา' }, prefilledData: { vendorName: 'ประสิทธิ์', sampleAmount: 12000 } });
    const ins = template({ id: 'tpl-ins', name: 'ประกันภัยร้าน', recurrence: 'YEARLY', recurringDay: 29, recurringMonth: 10, prefilledData: { vendorName: 'ทิพย', sampleAmount: 18900 } });
    const water = template({ id: 'tpl-water', name: 'ค่าน้ำ', recurringDay: 31, branchId: 'br-2', branch: { name: 'บางนา' }, prefilledData: { vendorName: 'กปน.', sampleAmount: 900 } });
    const acct = template({ id: 'tpl-acct', name: 'ค่าทำบัญชี', recurrence: 'QUARTERLY', recurringDay: 5, recurringMonth: 1, prefilledData: { vendorName: 'สนง.', sampleAmount: 6000 } });
    const rows = [
      occurrence({ id: 'o-rent', templateId: 'tpl-rent', template: rent, dueDate: bkkMidnight(2026, 10, 1), status: 'PAID', paidAt: bkkNoon(2026, 9, 30), estimatedAmount: '25000', expenseDocumentId: 'd-rent', expenseDocument: paidDoc('d-rent', 'EX-20260928-0003', bkkNoon(2026, 9, 30)) }),
      occurrence({ id: 'o-elec', templateId: 'tpl-elec', template: elec, dueDate: bkkMidnight(2026, 10, 15), status: 'PAID', paidById: 'u-som', paidAt: bkkNoon(2026, 10, 14), paidNote: 'ตัดบัตรอัตโนมัติ', paidBy: { name: 'สมหญิง' }, estimatedAmount: '8500', expenseDocumentId: 'd-elec', expenseDocument: draftDoc('d-elec', 'EX-20261012-0007') }),
      occurrence({ id: 'o-net', templateId: 'tpl-net', template: net, dueDate: bkkMidnight(2026, 10, 24), estimatedAmount: '1284' }),
      occurrence({ id: 'o-wh', templateId: 'tpl-wh', template: wh, dueDate: bkkMidnight(2026, 10, 26), estimatedAmount: '12000', expenseDocumentId: 'd-wh', expenseDocument: { ...draftDoc('d-wh', 'EX-20261023-0005'), deletedAt: new Date() } }),
      occurrence({ id: 'o-ins', templateId: 'tpl-ins', template: ins, periodKey: '2026', dueDate: bkkMidnight(2026, 10, 29), estimatedAmount: '18900', expenseDocumentId: 'd-ins', expenseDocument: draftDoc('d-ins', 'EX-20261026-0001') }),
      occurrence({ id: 'o-acct', templateId: 'tpl-acct', template: acct, periodKey: '2026-Q4', dueDate: bkkMidnight(2026, 10, 5), status: 'SKIPPED', skippedAt: bkkNoon(2026, 10, 3), skippedById: 'u-ek', skipReason: 'จ่ายล่วงหน้าทั้งปีไปแล้วเมื่อ ก.ค.', skippedBy: { name: 'เอก' }, estimatedAmount: '6000', expenseDocument: draftDoc('d-acct', 'EX-20261002-0004') }),
    ];
    return { rows, templates: [rent, elec, net, wh, ins, water, acct] };
  }

  it('L1 assembles the month: six real rows + one projected UPCOMING, statuses and summary as on the mockup', async () => {
    const f = monthFixture();
    prisma.recurringBillOccurrence.findMany.mockResolvedValue(f.rows);
    prisma.expenseTemplate.findMany.mockResolvedValue(f.templates);
    const view = await service.listMonth(ACC, '2026-10', undefined, NOW);
    const byName = Object.fromEntries(view.rows.map((r) => [r.templateName, r]));
    expect(view.rows.map((r) => r.templateName)).toEqual(['ค่าเช่าร้าน', 'ค่าทำบัญชี', 'ค่าไฟ', 'อินเทอร์เน็ต', 'ค่าเช่าโกดัง', 'ประกันภัยร้าน', 'ค่าน้ำ']);
    expect(byName['ค่าเช่าร้าน'].status).toBe('PAID');
    expect(byName['ค่าไฟ']).toMatchObject({ status: 'PAID_UNPOSTED', paidByName: 'สมหญิง', paidNote: 'ตัดบัตรอัตโนมัติ' });
    expect(byName['อินเทอร์เน็ต']).toMatchObject({ status: 'OVERDUE', daysOverdue: 2, documentMissing: false, document: expect.objectContaining({ number: 'EX-20261021-0002', status: 'DRAFT' }) });
    expect(byName['ค่าเช่าโกดัง']).toMatchObject({ status: 'DUE_TODAY', documentMissing: true, branch: { id: 'br-2', name: 'บางนา' } });
    expect(byName['ค่าเช่าโกดัง'].document).toMatchObject({ number: 'EX-20261023-0005', deletedAt: expect.any(String) }); // หน้าเว็บโชว์ "EX-… ถูกลบ 25 ต.ค." (§15.2)
    expect(byName['อินเทอร์เน็ต'].document).toMatchObject({ deletedAt: null });
    expect(byName['ประกันภัยร้าน']).toMatchObject({ status: 'PENDING', daysUntilDue: 3, periodLabel: 'ปี 2569', document: expect.objectContaining({ number: 'EX-20261026-0001', status: 'DRAFT' }) });
    expect(byName['ค่าน้ำ']).toMatchObject({ status: 'UPCOMING', occurrenceId: null, awaitingSystem: false, periodKey: '2026-10', expectedAmount: '900' });
    expect(byName['ค่าน้ำ'].dueDate).toBe(bkkMidnight(2026, 10, 31).toISOString());
    expect(byName['ค่าน้ำ'].windowOpensOn).toBe(bkkMidnight(2026, 10, 28).toISOString()); // lead 3 → หน้าเว็บบอก "ระบบจะสร้างร่าง 28 ต.ค."
    expect(byName['อินเทอร์เน็ต'].windowOpensOn).toBe(bkkMidnight(2026, 10, 21).toISOString());
    expect(byName['ค่าทำบัญชี']).toMatchObject({ status: 'SKIPPED', skippedByName: 'เอก', periodLabel: 'ไตรมาส 4/2569', skippedAt: bkkNoon(2026, 10, 3).toISOString() });
    expect(view.summary).toEqual({ upcoming: 1, pending: 1, dueToday: 1, overdue: 1, paid: 1, paidUnposted: 1, skipped: 1, amountRemaining: '33084.00' });
    expect(prisma.recurringBillOccurrence.findMany.mock.calls[0][0].where).toMatchObject({ dueDate: { gte: bkkMidnight(2026, 10, 1), lt: bkkMidnight(2026, 11, 1) } });
  });

  it('L2 projection: a period already passed without a row is not shown; a window already open without a row is awaitingSystem', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([]);
    prisma.expenseTemplate.findMany.mockResolvedValue([
      template({ id: 'tpl-past', name: 'ผ่านไปแล้ว', recurringDay: 10, startsOn: bkkMidnight(2026, 9, 1) }),
      template({ id: 'tpl-open', name: 'หน้าต่างเปิด', recurringDay: 28, startsOn: bkkMidnight(2026, 9, 1) }),
      template({ id: 'tpl-before-start', name: 'ก่อนเริ่ม', recurringDay: 30, startsOn: bkkMidnight(2026, 11, 1) }),
    ]);
    const view = await service.listMonth(ACC, '2026-10', undefined, NOW);
    expect(view.rows.map((r) => [r.templateName, r.status, r.awaitingSystem])).toEqual([['หน้าต่างเปิด', 'UPCOMING', true]]);
  });

  it('L3 BRANCH_MANAGER is locked to the own branch (query param ignored); BM without branch → 403', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([]);
    prisma.expenseTemplate.findMany.mockResolvedValue([]);
    await service.listMonth(BM, '2026-10', 'br-2', NOW);
    expect(prisma.recurringBillOccurrence.findMany.mock.calls[0][0].where).toMatchObject({ template: { branchId: 'br-1' } });
    expect(prisma.expenseTemplate.findMany.mock.calls[0][0].where).toMatchObject({ branchId: 'br-1' });
    await expect(service.listMonth({ ...BM, branchId: null }, '2026-10', undefined, NOW)).rejects.toThrow(/สาขา/);
    await expect(service.listMonth(ACC, '2026-13', undefined, NOW)).rejects.toThrow(/เดือน/);
  });
});

describe('occurrence actions', () => {
  const ACC = { id: 'u-acc', branchId: null, role: 'ACCOUNTANT' };
  const BM2 = { id: 'u-bm2', branchId: 'br-2', role: 'BRANCH_MANAGER' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;
  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new RecurringBillsService(prisma, templates, notifier, audit);
    prisma.recurringBillOccurrence.findUnique = jest.fn().mockResolvedValue(occurrence());
  });

  it('M1 markPaid: CAS PENDING→PAID with the actor and note, todo becomes "ลงบัญชีใบ …", audit after; 409 when not PENDING or when the state moved', async () => {
    const res = await service.markPaid('occ-1', ACC, { note: 'ตัดบัตร' }, NOW);
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', status: 'PENDING' }, data: { status: 'PAID', paidAt: NOW, paidById: 'u-acc', paidNote: 'ตัดบัตร' } });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: expect.stringMatching(/^ลงบัญชีใบ EX-20261021-0002/) }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECURRING_BILL_MARKED_PAID', entity: 'recurring_bill_occurrence', entityId: 'occ-1', userId: 'u-acc' }));
    expect(res.status).toBe('PAID');

    prisma.recurringBillOccurrence.findUnique.mockResolvedValue(occurrence({ status: 'PAID', paidById: 'u-acc' }));
    await expect(service.markPaid('occ-1', ACC, {}, NOW)).rejects.toThrow(/รอจ่าย/);
    prisma.recurringBillOccurrence.findUnique.mockResolvedValue(occurrence());
    prisma.recurringBillOccurrence.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markPaid('occ-1', ACC, {}, NOW)).rejects.toThrow(/เปลี่ยน/);
  });

  it('M1b markPaid with a paidAt date in the future → 400; BM of another branch → 403', async () => {
    await expect(service.markPaid('occ-1', ACC, { paidAt: '2026-10-27' }, NOW)).rejects.toThrow(/อนาคต|วันนี้/);
    await expect(service.markPaid('occ-1', BM2, {}, NOW)).rejects.toThrow(/สาขา/);
  });

  it('M2 skip: PENDING→SKIPPED by the actor with reason, todo closed, system DRAFT soft-deleted', async () => {
    await service.skip('occ-1', ACC, { reason: 'จ่ายล่วงหน้าทั้งปีแล้ว' }, NOW);
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', status: 'PENDING' }, data: { status: 'SKIPPED', skippedAt: NOW, skippedById: 'u-acc', skipReason: 'จ่ายล่วงหน้าทั้งปีแล้ว' } });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DONE' }) }));
    expect(prisma.expenseDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doc-1', status: 'DRAFT', deletedAt: null } }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECURRING_BILL_SKIPPED' }));
  });

  it('M3 reopen: system-paid → 409 naming the document; manually paid → PENDING + todo back to TODO; missed (system-skipped, no draft) → PENDING + draft created by the actor', async () => {
    prisma.recurringBillOccurrence.findUnique.mockResolvedValue(occurrence({ status: 'PAID', paidById: null, expenseDocument: { id: 'doc-1', number: 'EX-1', status: 'POSTED', paidAt: NOW, deletedAt: null, documentDate: NOW, createdById: 'u' } }));
    await expect(service.reopen('occ-1', ACC, NOW)).rejects.toThrow(/EX-1.*ยกเลิกใบนั้น/);

    prisma.recurringBillOccurrence.findUnique.mockResolvedValue(occurrence({ status: 'PAID', paidById: 'u-som', paidAt: NOW }));
    await service.reopen('occ-1', ACC, NOW);
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', status: 'PAID' }, data: { status: 'PENDING', paidAt: null, paidById: null, paidNote: null, skippedAt: null, skippedById: null, skipReason: null } });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'TODO' }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECURRING_BILL_REOPENED' }));

    jest.clearAllMocks();
    prisma.recurringBillOccurrence.findUnique.mockResolvedValue(occurrence({ status: 'SKIPPED', skippedById: null, skipReason: 'งวดผ่านไปก่อนระบบเริ่มติดตาม', expenseDocumentId: null, expenseDocument: null, todoId: null, todo: null }));
    await service.reopen('occ-1', ACC, NOW);
    expect(templates.instantiate).toHaveBeenCalledWith('tpl-1', ACC, { documentDate: bkkNoon(2026, 10, 24) });
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
  });

  it('M4 createDraft: live draft → 409; deleted template → 409; voided document → new draft by the actor, linked', async () => {
    await expect(service.createDraft('occ-1', ACC, NOW)).rejects.toThrow(/ร่าง.*อยู่แล้ว/);
    prisma.recurringBillOccurrence.findUnique.mockResolvedValue(occurrence({ template: template({ recurringDay: 24, deletedAt: new Date() }), expenseDocument: null, expenseDocumentId: null }));
    await expect(service.createDraft('occ-1', ACC, NOW)).rejects.toThrow(/ถูกลบ/);
    prisma.recurringBillOccurrence.findUnique.mockResolvedValue(occurrence({ expenseDocument: { id: 'doc-1', number: 'EX-1', status: 'VOIDED', paidAt: null, deletedAt: null, documentDate: NOW, createdById: 'u' } }));
    const res = await service.createDraft('occ-1', ACC, NOW);
    expect(templates.instantiate).toHaveBeenCalledWith('tpl-1', ACC, { documentDate: bkkNoon(2026, 10, 24) });
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', expenseDocumentId: 'doc-1' }, data: { expenseDocumentId: 'doc-1' } });
    expect(res.documentNumber).toBe('EX-20261028-0001');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECURRING_BILL_DRAFT_CREATED' }));
  });

  it('M5 templates_enabled=false → markPaid/skip/reopen 403 with the standard message, nothing written (รีวิว M1 · Review Focus #3)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
    await expect(service.markPaid('occ-1', ACC, {}, NOW)).rejects.toThrow('ระบบรายการโปรดถูกปิดใช้งานชั่วคราว');
    await expect(service.skip('occ-1', ACC, { reason: 'จ่ายล่วงหน้าแล้ว' }, NOW)).rejects.toThrow('ระบบรายการโปรดถูกปิดใช้งานชั่วคราว');
    await expect(service.reopen('occ-1', ACC, NOW)).rejects.toThrow('ระบบรายการโปรดถูกปิดใช้งานชั่วคราว');
    expect(prisma.recurringBillOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('M6 createDraft loses the link race → its extra draft is soft-deleted and 409 (รีวิว I1 · Review Focus #5)', async () => {
    prisma.recurringBillOccurrence.findUnique.mockResolvedValue(occurrence({ expenseDocument: { ...occurrence().expenseDocument, deletedAt: new Date() } }));
    templates.instantiate.mockResolvedValue({ id: 'doc-new', number: 'EX-NEW' });
    prisma.recurringBillOccurrence.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.createDraft('occ-1', ACC, NOW)).rejects.toThrow(/ร่าง.*อยู่แล้ว/);
    expect(prisma.recurringBillOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', expenseDocumentId: 'doc-1' }, data: { expenseDocumentId: 'doc-new' } });
    expect(prisma.expenseDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doc-new', status: 'DRAFT', deletedAt: null }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
    expect(audit.log).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'RECURRING_BILL_DRAFT_CREATED' }));
  });
});

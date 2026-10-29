import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { addCalendarDays, bkkCalendarDate } from '@installment/shared';
import { bkkMidnightOf } from '../recurring-bills/recurring-bills.service';
const dayKey = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
import { ExpenseTemplatesService } from '../expense-templates.service';

describe('ExpenseTemplatesService', () => {
  let service: ExpenseTemplatesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docsService: any;

  beforeEach(() => {
    prisma = {
      expenseTemplate: {
        create: jest.fn().mockResolvedValue({ id: 'tpl-1', name: 'ค่าไฟ' }),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
      },
      systemConfig: {
        findFirst: jest.fn().mockResolvedValue(null), // default → cap=20
      },
      // D1.2.4.2 — `$transaction(cb)` runs the callback with the prisma
      // mock itself acting as the tx client.
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
    };
    // Documents service mock — for instantiate
    docsService = {
      create: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20260510-0001' }),
      createCreditNote: jest.fn().mockResolvedValue({ id: 'doc-2' }),
      createPayroll: jest.fn().mockResolvedValue({ id: 'doc-3' }),
      createSettlement: jest.fn().mockResolvedValue({ id: 'doc-4' }),
    };
    service = new ExpenseTemplatesService(prisma, docsService);
  });

  describe('create', () => {
    it('rejects when isRecurring=true without recurringDay', async () => {
      await expect(service.create({
        name: 'X', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: {}, isRecurring: true,
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' })).rejects.toThrow(BadRequestException);
    });

    it('rejects cross-branch for non-OWNER role', async () => {
      await expect(service.create({
        name: 'X', documentType: 'EXPENSE', branchId: 'b2',
        prefilledData: {},
      } as never, { id: 'u1', branchId: 'b1', role: 'BRANCH_MANAGER' })).rejects.toThrow(ForbiddenException);
    });

    it('happy path creates template', async () => {
      await service.create({
        name: 'ค่าไฟ', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: { vendorName: 'การไฟฟ้า', category: '53-1302' },
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(prisma.expenseTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'ค่าไฟ',
            documentType: 'EXPENSE',
            createdById: 'u1',
          }),
        }),
      );
    });

    // D1.2.4.2 — quota check + create wrapped in $transaction
    it('runs quota check + insert inside a single $transaction (TOCTOU-safe)', async () => {
      await service.create({
        name: 'ค่าไฟ', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: {},
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // count + create both invoked once inside the tx callback.
      // D5: โควต้านับเฉพาะแม่แบบที่ไม่ใช่บิลประจำ (spec §13 ข้อ 5)
      expect(prisma.expenseTemplate.count).toHaveBeenCalledWith({
        where: { createdById: 'u1', deletedAt: null, isRecurring: false },
      });
      expect(prisma.expenseTemplate.create).toHaveBeenCalled();
    });

    it('rejects when count >= cap (default cap 20, count 20 → reject)', async () => {
      prisma.expenseTemplate.count.mockResolvedValueOnce(20);
      await expect(service.create({
        name: 'ค่าไฟ', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: {},
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' })).rejects.toThrow(/โควต้า/);
      expect(prisma.expenseTemplate.create).not.toHaveBeenCalled();
    });

    it('respects custom cap from SystemConfig (cap 5, count 5 → reject)', async () => {
      // ExpenseTemplatesService.create() calls systemConfig.findFirst twice:
      //   1) assertTemplatesEnabled — key='templates_enabled' (D1.2.4.1)
      //   2) readUserQuotaCap     — key='max_templates_per_user' (D1.2.4.2)
      // Use a key-aware mockImplementation so the cap row is only returned
      // for the second call regardless of invocation order.
      prisma.systemConfig.findFirst.mockImplementation(({ where }: { where: { key: string } }) => {
        if (where.key === 'max_templates_per_user') return Promise.resolve({ value: '5' });
        return Promise.resolve(null);
      });
      prisma.expenseTemplate.count.mockResolvedValueOnce(5);
      await expect(service.create({
        name: 'ค่าไฟ', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: {},
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' })).rejects.toThrow(/โควต้า/);
    });
  });

  describe('list', () => {
    it('filters by branchId + excludes deleted', async () => {
      await service.list({ branchId: 'b1' }, { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(prisma.expenseTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'b1', deletedAt: null }),
        }),
      );
    });

    // ── Branch-scope hardening (Group 1 review follow-up) ──────────────
    it('OWNER (cross-branch) sees all branches when no filter passed', async () => {
      await service.list({}, { id: 'u1', branchId: 'b1', role: 'OWNER' });
      // No branchId on the where clause = "all branches" (cross-branch view)
      const callArg = prisma.expenseTemplate.findMany.mock.calls[0][0];
      expect(callArg.where.deletedAt).toBeNull();
      expect(callArg.where.branchId).toBeUndefined();
    });

    it('SALES (single-branch) is locked to user.branchId — ignores cross-branch filter', async () => {
      // SALES tries to spoof another branch via ?branchId=b2 — must be forced back to b1
      await service.list({ branchId: 'b2' }, { id: 'u1', branchId: 'b1', role: 'SALES' });
      expect(prisma.expenseTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'b1', deletedAt: null }),
        }),
      );
    });

    it('SALES with no user.branchId is rejected (misconfigured user)', async () => {
      await expect(
        service.list({ branchId: 'b2' }, { id: 'u1', branchId: null, role: 'SALES' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('BRANCH_MANAGER without filter is locked to their own branch', async () => {
      await service.list({}, { id: 'u1', branchId: 'b1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'b1', deletedAt: null }),
        }),
      );
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'tpl-1', branchId: 'b1', deletedAt: null });
      await service.softDelete('tpl-1', { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(prisma.expenseTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });

    it('rejects when already deleted', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'tpl-1', branchId: 'b1', deletedAt: new Date() });
      await expect(service.softDelete('tpl-1', { id: 'u1', branchId: 'b1', role: 'OWNER' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('instantiate', () => {
    it('creates EXPENSE doc with prefilledData + fromTemplateId', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({
        id: 'tpl-1',
        documentType: 'EXPENSE',
        branchId: 'b1',
        deletedAt: null,
        prefilledData: { vendorName: 'การไฟฟ้า', category: '53-1302', paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201' },
      });
      await service.instantiate('tpl-1', { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(docsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          documentType: 'EXPENSE',
          branchId: 'b1',
          vendorName: 'การไฟฟ้า',
          paymentMethod: 'BANK_TRANSFER',
          depositAccountCode: '11-1201',
          fromTemplateId: 'tpl-1',
          lines: expect.arrayContaining([
            expect.objectContaining({ category: '53-1302' }),
          ]),
        }),
        'u1',
      );
    });

    it('PAYROLL template → createPayroll with stripTypedOt (typed OT of clocked staff is dropped, not refused — owner 2026-10-29)', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({
        id: 'tpl-p', documentType: 'PAYROLL', branchId: 'b1', deletedAt: null,
        prefilledData: { entityScope: 'SHOP', lines: [{ userId: 'u9', baseSalary: 15000 }] },
      });
      const user = { id: 'u1', branchId: 'b1', role: 'OWNER' };
      await service.instantiate('tpl-p', user);
      expect(docsService.createPayroll).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'b1', fromTemplateId: 'tpl-p', lines: [{ userId: 'u9', baseSalary: 15000 }] }),
        user,
        { stripTypedOt: true },
      );
    });

    it('rejects cross-branch instantiate', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({
        id: 'tpl-1', documentType: 'EXPENSE', branchId: 'b2', deletedAt: null, prefilledData: {},
      });
      await expect(service.instantiate('tpl-1', { id: 'u1', branchId: 'b1', role: 'BRANCH_MANAGER' }))
        .rejects.toThrow(ForbiddenException);
    });
  });
});

// ─── ก้อน 6 บิลประจำ (D5) — กติกาแม่แบบบิลประจำ (spec §8 + §15.1/§15.5) ─────────────
describe('recurring bill rules (D5)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: ExpenseTemplatesService;
  const owner = { id: 'u1', branchId: 'b1', role: 'OWNER' };
  const base = { name: 'ค่าเน็ต', documentType: 'EXPENSE', branchId: 'b1', prefilledData: { vendorName: 'AIS', category: '53-1302', sampleAmount: 1284 } };

  beforeEach(() => {
    prisma = {
      expenseTemplate: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'tpl-1', ...data })),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'tpl-1', ...data })),
      },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    service = new ExpenseTemplatesService(prisma, { create: jest.fn() } as never);
  });

  const create = (dto: Record<string, unknown>) => service.create({ ...base, ...dto } as never, owner);

  it('QUARTERLY without recurringMonth → 400 ไทย', async () => {
    await expect(create({ isRecurring: true, recurrence: 'QUARTERLY', recurringDay: 5 })).rejects.toThrow(/เดือน/);
  });
  it('YEARLY with recurringMonth 13 → 400', async () => {
    await expect(create({ isRecurring: true, recurrence: 'YEARLY', recurringDay: 1, recurringMonth: 13 })).rejects.toThrow(BadRequestException);
  });
  it('MONTHLY with a recurringMonth → 400', async () => {
    await expect(create({ isRecurring: true, recurrence: 'MONTHLY', recurringDay: 1, recurringMonth: 2 })).rejects.toThrow(BadRequestException);
  });
  it('isRecurring without recurrence → 400', async () => {
    await expect(create({ isRecurring: true, recurringDay: 1 })).rejects.toThrow(/ความถี่/);
  });
  it('PAYROLL cannot be a recurring bill', async () => {
    await expect(create({ documentType: 'PAYROLL', isRecurring: true, recurrence: 'MONTHLY', recurringDay: 1 })).rejects.toThrow(/ใบรายจ่าย/);
  });
  it('reminderLeadDays 31 → 400; startsOn too far back / ahead → 400', async () => {
    await expect(create({ isRecurring: true, recurrence: 'MONTHLY', recurringDay: 1, reminderLeadDays: 31 })).rejects.toThrow(BadRequestException);
    await expect(create({ isRecurring: true, recurrence: 'MONTHLY', recurringDay: 1, startsOn: '2020-01-01' })).rejects.toThrow(/ย้อนหลัง/);
    await expect(create({ isRecurring: true, recurrence: 'MONTHLY', recurringDay: 1, startsOn: '2099-01-01' })).rejects.toThrow(BadRequestException);
  });
  it('invalid paymentMethod / depositAccountCode in prefilledData → 400', async () => {
    await expect(create({ prefilledData: { ...base.prefilledData, paymentMethod: 'CREDIT_BALANCE' }, isRecurring: true, recurrence: 'MONTHLY', recurringDay: 1 })).rejects.toThrow(/วิธีจ่าย/);
    await expect(create({ prefilledData: { ...base.prefilledData, paymentMethod: 'BANK_TRANSFER', depositAccountCode: '99-9999' }, isRecurring: true, recurrence: 'MONTHLY', recurringDay: 1 })).rejects.toThrow(/บัญชี/);
  });
  it('a recurring bill is exempt from the per-user quota, while plain templates still count', async () => {
    prisma.expenseTemplate.count.mockResolvedValue(20);
    await expect(create({ isRecurring: true, recurrence: 'MONTHLY', recurringDay: 1 })).resolves.toBeTruthy();
    expect(prisma.expenseTemplate.count).toHaveBeenCalledWith({ where: { createdById: 'u1', deletedAt: null, isRecurring: false } });
    await expect(create({})).rejects.toThrow(/โควต้า/);
  });
  it('stores recurrence fields and normalises startsOn to Thai midnight (default = today)', async () => {
    await create({ isRecurring: true, recurrence: 'QUARTERLY', recurringDay: 31, recurringMonth: 2, reminderLeadDays: 7, prefilledData: { ...base.prefilledData, paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201' } });
    const data = prisma.expenseTemplate.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ isRecurring: true, recurrence: 'QUARTERLY', recurringDay: 31, recurringMonth: 2, reminderLeadDays: 7 });
    expect(data.startsOn).toBeInstanceOf(Date);
    expect(data.startsOn.getUTCHours()).toBe(17); // เที่ยงคืนไทย = 17:00Z ของวันก่อน
    const in5 = addCalendarDays(bkkCalendarDate(new Date()), 5); // สัมพัทธ์กับวันนี้ — กันเทสหมดอายุเมื่อเกินเพดาน 90 วัน (รีวิว M8)
    await create({ isRecurring: true, recurrence: 'MONTHLY', recurringDay: 5, startsOn: dayKey(in5) });
    expect(prisma.expenseTemplate.create.mock.calls[1][0].data.startsOn).toEqual(bkkMidnightOf(in5));
  });

  describe('update', () => {
    const existing = {
      id: 'tpl-1', name: 'ค่าเน็ต', documentType: 'EXPENSE', branchId: 'b1', deletedAt: null, createdById: 'u1',
      isRecurring: true, recurrence: 'MONTHLY', recurringDay: 24, recurringMonth: null, reminderLeadDays: 3,
      startsOn: new Date('2026-09-30T17:00:00.000Z'), prefilledData: base.prefilledData,
    };
    beforeEach(() => prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue(existing));

    it('validates on the merged row — switching to QUARTERLY without a month → 400', async () => {
      await expect(service.update('tpl-1', { recurrence: 'QUARTERLY' } as never, owner)).rejects.toThrow(/เดือน/);
    });
    it('turning isRecurring off clears recurrence fields, no ruleChanged', async () => {
      const res = await service.update('tpl-1', { isRecurring: false } as never, owner);
      expect(prisma.expenseTemplate.update.mock.calls[0][0].data).toMatchObject({ isRecurring: false, recurrence: null, recurringMonth: null });
      expect(res.ruleChanged).toBe(false);
    });
    it('changing the day marks ruleChanged and moves startsOn forward to today', async () => {
      const res = await service.update('tpl-1', { recurringDay: 10 } as never, owner);
      expect(res.ruleChanged).toBe(true);
      const data = prisma.expenseTemplate.update.mock.calls[0][0].data;
      expect(data.recurringDay).toBe(10);
      expect((data.startsOn as Date).getTime()).toBeGreaterThan(existing.startsOn.getTime());
      expect((data.startsOn as Date).getUTCHours()).toBe(17);
    });
    it('echoing the stored startsOn (older than 90 days) is accepted — only a changed value is range-checked; a rule change still moves it to today (รีวิว I2)', async () => {
      const update = (dto: Record<string, unknown>) => service.update('tpl-1', dto as never, owner);
      const d = addCalendarDays(bkkCalendarDate(new Date()), -120);
      const stored = bkkMidnightOf(d);
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({ ...existing, startsOn: stored });
      const renamed = await update({ name: 'ชื่อใหม่', startsOn: dayKey(d) });
      expect(renamed.ruleChanged).toBe(false);
      expect(prisma.expenseTemplate.update.mock.calls[0][0].data.startsOn).toBeUndefined();
      jest.clearAllMocks();
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({ ...existing, startsOn: stored });
      const res = await update({ recurringDay: 28, startsOn: dayKey(d) });
      expect(res.ruleChanged).toBe(true);
      const moved = prisma.expenseTemplate.update.mock.calls[0][0].data.startsOn as Date;
      expect(moved.getTime()).toBeGreaterThan(stored.getTime());
      expect(moved.getUTCHours()).toBe(17);
      await expect(update({ name: 'x', startsOn: '2020-01-01' })).rejects.toThrow(/ย้อนหลัง/);
    });
    it('a rule change with an explicit future startsOn keeps that date (max(startsOn, today))', async () => {
      const update = (dto: Record<string, unknown>) => service.update('tpl-1', dto as never, owner);
      const d = addCalendarDays(bkkCalendarDate(new Date()), 10);
      const res = await update({ recurringDay: 28, startsOn: dayKey(d) });
      expect(res.ruleChanged).toBe(true);
      expect(prisma.expenseTemplate.update.mock.calls[0][0].data.startsOn).toEqual(bkkMidnightOf(d));
    });
    it('renaming only does not mark ruleChanged nor touch startsOn', async () => {
      const res = await service.update('tpl-1', { name: 'ค่าเน็ตบ้าน' } as never, owner);
      expect(res.ruleChanged).toBe(false);
      expect(prisma.expenseTemplate.update.mock.calls[0][0].data.startsOn).toBeUndefined();
    });
    it('turning isRecurring on for the first time sets startsOn = today and ruleChanged', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({ ...existing, isRecurring: false, recurrence: null, recurringDay: null, startsOn: null });
      const res = await service.update('tpl-1', { isRecurring: true, recurrence: 'MONTHLY', recurringDay: 5 } as never, owner);
      expect(res.ruleChanged).toBe(true);
      expect(prisma.expenseTemplate.update.mock.calls[0][0].data.startsOn).toBeInstanceOf(Date);
    });
  });
});

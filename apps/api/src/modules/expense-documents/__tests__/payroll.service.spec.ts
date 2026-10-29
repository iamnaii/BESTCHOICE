import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { makeExpenseDocumentsService } from './support/make-expense-documents-service';

describe('ExpenseDocumentsService.createPayroll', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docNumber: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      // Duplicate-period guard (2026-08-06) — advisory lock + existing-doc probe
      // run inside the tx before create. findFirst → null = no duplicate.
      $executeRaw: jest.fn().mockResolvedValue(0),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({ id: 'pr-1', number: 'PR-20260510-0001' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('PR-20260510-0001') };
    const transition: any = {};
    const sameDay: any = {};
    const accrual: any = {};
    const cn: any = {};
    const payroll: any = { execute: jest.fn() };
    const settlement: any = { execute: jest.fn() };
    service = makeExpenseDocumentsService({
      prisma,
      docNumber,
      transition,
      sameDayTemplate: sameDay,
      accrualTemplate: accrual,
      creditNoteTemplate: cn,
      payrollTemplate: payroll,
      settlementTemplate: settlement,
      journal: { createAndPost: jest.fn() },
      jePreview: { preview: jest.fn() },
      // ssoConfig: pass-through. Cap-validation behavior is tested in
      // sso-config.service.spec.ts. Tests here use ssoEmployee values within
      // the 2569+ cap of 875, so a no-op validator is sound.
      ssoConfig: { validateContribution: jest.fn().mockResolvedValue(undefined) },
      // pettyCashTemplate + pettyCash mocks (C1) — payroll path doesn't touch them
      pettyCashTemplate: { execute: jest.fn() },
      pettyCash: { getConfig: jest.fn(), validate: jest.fn() },
      // payrollCustom mock — fixtures don't exercise custom income/deduction; loadWhitelist
      // returns the seeded default + validateLine no-ops.
      payrollCustom: {
        loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1103', '53-1104'])),
        validateLine: jest.fn().mockResolvedValue({ taxableBase: undefined }),
        validateDeductionAccounts: jest.fn().mockResolvedValue(undefined),
      },
      notifications: { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) },
    }).service;
  });

  it('rejects negative netPaid (sso + wht > baseSalary)', async () => {
    await expect(
      service.createPayroll(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          payrollPeriod: '2026-05',
          depositAccountCode: '11-1101',
          lines: [{ employeeName: 'อก', baseSalary: 1000, ssoEmployee: 700, whtAmount: 500 }],
        } as never,
        { id: 'user-1', branchId: 'b1', role: 'OWNER' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('computes netPaid per line + sums correctly across multiple lines', async () => {
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-05-10',
        payrollPeriod: '2026-05',
        depositAccountCode: '11-1101',
        lines: [
          { employeeName: 'อก', baseSalary: 10000, ssoEmployee: 750, whtAmount: 0 },
          { employeeName: 'อข', baseSalary: 15000, ssoEmployee: 750, whtAmount: 300 },
        ],
      } as never,
      { id: 'user-1', branchId: 'b1', role: 'OWNER' },
    );
    const arg = prisma.expenseDocument.create.mock.calls[0][0];
    expect(arg.data.subtotal.toString()).toBe('25000');
    expect(arg.data.withholdingTax.toString()).toBe('300');
    expect(arg.data.netPayment.toString()).toBe('23200');
    // Lines passed to nested create
    const lines = arg.data.payroll.create.lines.create;
    expect(lines[0].netPaid.toString()).toBe('9250');
    expect(lines[1].netPaid.toString()).toBe('13950');
    expect(lines.map((l: { lineNo: number }) => l.lineNo)).toEqual([1, 2]);
  });

  it('totalAmount = gross (Σ base + Σ custom income) · subtotal stays Σ base (Payroll D4)', async () => {
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-05-10',
        payrollPeriod: '2026-05',
        depositAccountCode: '11-1101',
        lines: [
          { employeeName: 'อก', baseSalary: 10000, ssoEmployee: 500, customIncome: [{ accountCode: '53-1104', name: 'โบนัส', amount: 1500.5 }] },
          { employeeName: 'อข', baseSalary: 8000 },
        ],
      } as never,
      { id: 'user-1', branchId: 'b1', role: 'OWNER' },
    );
    const arg = prisma.expenseDocument.create.mock.calls[0][0];
    expect(arg.data.subtotal.toFixed(2)).toBe('18000.00');
    expect(arg.data.totalAmount.toFixed(2)).toBe('19500.50');
    expect(arg.data.netPayment.toFixed(2)).toBe('19000.50');
    // แถวที่ client ส่ง = MANUAL · บรรทัดไม่ผูกพนักงานไม่มี snapshot ลงเวลา
    const line0 = arg.data.payroll.create.lines.create[0];
    expect(line0.customIncome.create[0]).toMatchObject({ source: 'MANUAL', quantity: null, rate: null, multiplier: null });
    expect(line0.systemPulledAt).toBeNull();
    expect(line0.attendanceSummary).toBeUndefined();
  });

  it('a linked line without PayrollSystemRowsService wired fails closed (never saves without OT)', async () => {
    prisma.employeeProfile = {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'emp-1', taxIdOverride: null, user: { id: 'emp-1', name: 'สมชาย', nationalId: null, branchId: 'b1' } },
      ]),
    };
    await expect(
      service.createPayroll(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          payrollPeriod: '2026-05',
          depositAccountCode: '11-1101',
          lines: [{ userId: 'emp-1', baseSalary: 15000 }],
        } as never,
        { id: 'user-1', branchId: 'b1', role: 'OWNER' },
      ),
    ).rejects.toThrow('PayrollSystemRowsService not wired');
    expect(prisma.expenseDocument.create).not.toHaveBeenCalled();
  });

  it('rejects non-cross-branch user creating payroll for another branch (ForbiddenException)', async () => {
    await expect(
      service.createPayroll(
        {
          branchId: 'b2',
          documentDate: '2026-05-10',
          payrollPeriod: '2026-05',
          depositAccountCode: '11-1101',
          lines: [{ employeeName: 'อก', baseSalary: 5000 }],
        } as never,
        { id: 'user-1', branchId: 'b1', role: 'BRANCH_MANAGER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.expenseDocument.create).not.toHaveBeenCalled();
  });

  it('allows OWNER to create payroll for any branch (cross-branch)', async () => {
    await service.createPayroll(
      {
        branchId: 'b2',
        documentDate: '2026-05-10',
        payrollPeriod: '2026-05',
        depositAccountCode: '11-1101',
        lines: [{ employeeName: 'อก', baseSalary: 5000 }],
      } as never,
      { id: 'user-1', branchId: 'other-branch', role: 'OWNER' },
    );
    expect(prisma.expenseDocument.create).toHaveBeenCalled();
  });

  it('happy path creates document with PAYROLL type + payroll detail + lines', async () => {
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-05-10',
        payrollPeriod: '2026-05',
        depositAccountCode: '11-1101',
        paymentMethod: 'BANK_TRANSFER',
        lines: [{ employeeName: 'อก', baseSalary: 5000 }],
      } as never,
      { id: 'user-1', branchId: 'b1', role: 'OWNER' },
    );
    expect(prisma.expenseDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentType: 'PAYROLL',
          number: 'PR-20260510-0001',
          status: 'DRAFT',
          createdById: 'user-1',
          payroll: { create: expect.objectContaining({ payrollPeriod: '2026-05' }) },
        }),
      }),
    );
  });
});

describe('ExpenseDocumentsService.createPayroll — attendance system rows (Payroll D4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let systemRows: any;
  let service: ExpenseDocumentsService;
  const calls: string[] = [];
  const profile = (userId: string, name: string) => ({ userId, taxIdOverride: null, user: { id: userId, name, nationalId: null, branchId: 'b1' } });

  beforeEach(() => {
    calls.length = 0;
    prisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, key: string) => {
        calls.push(key);
        return 0;
      }),
      employeeProfile: { findMany: jest.fn().mockResolvedValue([profile('emp-b', 'บี'), profile('emp-a', 'เอ')]) },
      expenseDocument: {
        create: jest.fn(async (args: unknown) => args),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    systemRows = {
      compute: jest.fn(async (_tx: unknown, q: { userIds: string[] }) => {
        calls.push(`compute:${q.userIds.join(',')}`);
        return {
          attendanceAccountCodes: ['53-1103'],
          rows: q.userIds.map((userId) => ({
            userId,
            autoOtEligible: true,
            attendanceTracked: true,
            systemIncome:
              userId === 'emp-a'
                ? [{ source: 'ATTENDANCE_OT', accountCode: '53-1103', name: 'OT วันทำงาน (1.5 เท่า)', quantity: '1.5', rate: '93.7500', multiplier: '1.5', amount: '140.63', isTaxable: true }]
                : [],
            attendanceSummary: { otHours: userId === 'emp-a' ? '1.5' : '0.0', autoOtEligible: true, attendanceTracked: true },
            notes: { review: [], warnings: [] },
          })),
        };
      }),
    };
    service = makeExpenseDocumentsService({
      prisma,
      docNumber: { next: jest.fn().mockResolvedValue('PR-20260510-0002') },
      ssoConfig: { validateContribution: jest.fn().mockResolvedValue(undefined) },
      payrollCustom: {
        loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1103', '53-1104'])),
        validateLine: jest.fn(),
        validateDeductionAccounts: jest.fn().mockResolvedValue(undefined),
      },
      systemRows,
    }).service;
  });

  const create = (lines: unknown[], user = { id: 'user-1', branchId: 'b1', role: 'OWNER' }) =>
    service.createPayroll(
      { branchId: 'b1', documentDate: '2026-05-31', payrollPeriod: '2026-05', entityScope: 'FINANCE', depositAccountCode: '11-1101', lines } as never,
      user,
    );

  it('locks payroll: then payroll-attendance:* for the linked users (sorted) before compute, on the same tx client', async () => {
    await create([{ userId: 'emp-b', baseSalary: 12000 }, { employeeName: 'ไม่ผูก', baseSalary: 5000 }, { userId: 'emp-a', baseSalary: 15000 }]);
    expect(calls).toEqual([
      'payroll:b1:2026-05:FINANCE',
      'payroll-attendance:emp-a:2026-05',
      'payroll-attendance:emp-b:2026-05',
      'compute:emp-a,emp-b',
    ]);
    expect(systemRows.compute).toHaveBeenCalledWith(prisma, expect.objectContaining({ branchId: 'b1', entityScope: 'FINANCE', payrollPeriod: '2026-05', userIds: ['emp-a', 'emp-b'] }));
    expect(systemRows.compute.mock.calls[0][1].excludeDocumentId).toBeUndefined();
  });

  it('appends the system rows to their line (client rows first) and nets them into netPaid / netPayment / totalAmount', async () => {
    const doc = (await create([
      { userId: 'emp-b', baseSalary: 12000 },
      { userId: 'emp-a', baseSalary: 15000, ssoEmployee: 750, customIncome: [{ accountCode: '53-1104', name: 'โบนัส', amount: 1000 }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- create mock echoes its Prisma args
    ])) as unknown as { data: Record<string, any> };
    const [b, a] = doc.data.payroll.create.lines.create;
    expect(a.customIncome.create.map((r: { source: string; amount: { toFixed(n: number): string } }) => [r.source, r.amount.toFixed(2)])).toEqual([
      ['MANUAL', '1000.00'],
      ['ATTENDANCE_OT', '140.63'],
    ]);
    expect(a.customIncome.create[1].rate.toFixed(4)).toBe('93.7500');
    expect(a.netPaid.toFixed(2)).toBe('15390.63');
    expect(b.customIncome).toBeUndefined();
    expect(b.netPaid.toFixed(2)).toBe('12000.00');
    expect(a.systemPulledAt).toBeInstanceOf(Date);
    expect(a.attendanceSummary).toEqual({ otHours: '1.5', autoOtEligible: true, attendanceTracked: true });
    expect(a.systemNotes).toEqual({ review: [], warnings: [] });
    expect([b.lineNo, a.lineNo]).toEqual([1, 2]);
    expect(doc.data.totalAmount.toFixed(2)).toBe('28140.63');
    expect(doc.data.netPayment.toFixed(2)).toBe('27390.63');
  });

  it('MANUAL row on an attendance account of an eligible line → 400 MANUAL_OT_DUPLICATE · ADJUSTMENT row passes', async () => {
    const ot = { accountCode: '53-1103', name: 'OT', amount: 300 };
    const err = await create([{ userId: 'emp-a', baseSalary: 15000, customIncome: [ot] }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      code: 'MANUAL_OT_DUPLICATE',
      message: 'เอ มีแถว OT ที่กรอกเองซ้ำกับ OT จากระบบลงเวลา — ลบแถวนั้น หรือติ๊ก "รายการปรับปรุงงวดก่อน" ถ้าเป็นการแก้ OT ของเดือนก่อน',
    });
    expect(prisma.expenseDocument.create).not.toHaveBeenCalled();

    await create([{ userId: 'emp-a', baseSalary: 15000, customIncome: [{ ...ot, isAdjustment: true }] }]);
    const line = prisma.expenseDocument.create.mock.calls[0][0].data.payroll.create.lines.create[0];
    expect(line.customIncome.create.map((r: { source: string }) => r.source)).toEqual(['ADJUSTMENT', 'ATTENDANCE_OT']);
  });

  it('non-cross-branch actor + employee of another branch → 403 NOT_IN_BRANCH before any lock', async () => {
    prisma.employeeProfile.findMany.mockResolvedValue([
      { userId: 'emp-x', taxIdOverride: null, user: { id: 'emp-x', name: 'คนสาขาอื่น', nationalId: null, branchId: 'b9' } },
    ]);
    const err = await create([{ userId: 'emp-x', baseSalary: 15000 }], { id: 'bm-1', branchId: 'b1', role: 'BRANCH_MANAGER' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toEqual({
      code: 'NOT_IN_BRANCH',
      message: 'คนสาขาอื่น ไม่ใช่พนักงานของสาขานี้ — ให้เจ้าของหรือฝ่ายบัญชีทำใบเงินเดือนนี้',
    });
    expect(calls).toEqual([]);
  });

  it('cross-branch actor (OWNER) may include another branch\'s employee', async () => {
    prisma.employeeProfile.findMany.mockResolvedValue([
      { userId: 'emp-x', taxIdOverride: null, user: { id: 'emp-x', name: 'คนสาขาอื่น', nationalId: null, branchId: 'b9' } },
    ]);
    await create([{ userId: 'emp-x', baseSalary: 15000 }]);
    expect(prisma.expenseDocument.create).toHaveBeenCalled();
  });

  it('resigned filter uses the period start (Bangkok 1st of the month), not "today"', async () => {
    await create([{ userId: 'emp-a', baseSalary: 15000 }]);
    const where = prisma.employeeProfile.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ resignedDate: null }, { resignedDate: { gte: new Date('2026-04-30T17:00:00.000Z') } }]);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { makeExpenseDocumentsService } from './support/make-expense-documents-service';

/**
 * R3-2 (2026-08-06) — แก้ไขใบเงินเดือน (PATCH /expense-documents/:id/payroll).
 * แทนที่ PayrollDetail+lines ทั้งชุด, validator ชุดเดียวกับ create, dup-งวด guard ยกเว้นตัวเอง.
 * Payroll D4: แก้ใบรออนุมัติ/อนุมัติแล้ว = ส่งกลับเป็นร่าง (audit SENT_BACK_TO_DRAFT ใน tx) ·
 * updatePayrollInTx ใช้ tx ของผู้เรียก (ไม่เปิด $transaction ซ้อน — Task 5 เรียกตอนส่งขออนุมัติ)
 */
describe('ExpenseDocumentsService.updatePayroll', () => {
  let service: any;
  let prisma: any;
  let made: any;
  let systemRows: any;
  const calls: string[] = [];

  const DOC_ID = 'pr-edit-1';
  const draftDoc = (over: Record<string, unknown> = {}) => ({
    id: DOC_ID,
    documentType: 'PAYROLL',
    status: 'DRAFT',
    branchId: 'b1',
    deletedAt: null,
    payroll: { entityScope: 'SHOP' },
    ...over,
  });

  const dto = {
    documentDate: '2026-08-05',
    payrollPeriod: '2026-08',
    entityScope: 'SHOP' as const,
    depositAccountCode: 'S11-1202',
    lines: [
      { employeeName: 'สมชาย แก้ไข', baseSalary: 13000, ssoEmployee: 650, whtAmount: 0 },
      { employeeName: 'สมหญิง แก้ไข', baseSalary: 19000, ssoEmployee: 875, whtAmount: 200 },
    ],
  };

  beforeEach(() => {
    calls.length = 0;
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRaw: jest.fn(async (_s: TemplateStringsArray, key: string) => {
        calls.push(key);
        return 0;
      }),
      expenseDocument: {
        findUnique: jest.fn().mockResolvedValue(draftDoc()),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(async (args: any) => ({ id: DOC_ID, ...args.data })),
      },
      payrollDetail: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      employeeProfile: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'emp-1', taxIdOverride: null, user: { id: 'emp-1', name: 'สมชาย ผูกทะเบียน', nationalId: null, branchId: 'b1' } },
        ]),
      },
    };
    systemRows = {
      compute: jest.fn(async (_tx: unknown, q: { userIds: string[] }) => {
        calls.push(`compute:${q.userIds.join(',')}`);
        return {
          attendanceAccountCodes: ['S52-1202'],
          rows: q.userIds.map((userId) => ({
            userId,
            autoOtEligible: true,
            attendanceTracked: true,
            systemIncome: [{ source: 'ATTENDANCE_OT', accountCode: 'S52-1202', name: 'OT วันทำงาน (1.5 เท่า)', quantity: '2.0', rate: '81.2500', multiplier: '1.5', amount: '162.50', isTaxable: true }],
            attendanceSummary: { otHours: '2.0', autoOtEligible: true, attendanceTracked: true },
            notes: { review: [], warnings: [] },
          })),
        };
      }),
    };
    made = makeExpenseDocumentsService({
      prisma,
      ssoConfig: { validateContribution: jest.fn().mockResolvedValue(undefined) },
      payrollCustom: {
        loadWhitelist: jest.fn().mockResolvedValue(new Set(['S52-1202', 'S52-1204'])),
        validateLine: jest.fn().mockResolvedValue({ taxableBase: undefined }),
        validateDeductionAccounts: jest.fn().mockResolvedValue(undefined),
      },
      systemRows,
    });
    service = made.service;
  });

  const OWNER = { id: 'u-owner', branchId: null, role: 'OWNER' };

  it('happy path: replaces PayrollDetail (deleteMany → recreate) + recomputes header totals', async () => {
    const doc = await service.updatePayroll(DOC_ID, dto, OWNER);

    expect(prisma.payrollDetail.deleteMany).toHaveBeenCalledWith({
      where: { documentId: DOC_ID },
    });
    const arg = prisma.expenseDocument.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: DOC_ID });
    expect(arg.data.subtotal.toString()).toBe('32000'); // 13,000 + 19,000
    expect(arg.data.totalAmount.toFixed(2)).toBe('32000.00'); // ไม่มีรายได้พิเศษ ⇒ ยอดก่อนหัก = Σ ฐาน
    expect(arg.data.withholdingTax.toString()).toBe('200');
    // net = (13000−650) + (19000−875−200) = 12,350 + 17,925 = 30,275
    expect(arg.data.netPayment.toString()).toBe('30275');
    // DRAFT คงเป็น DRAFT — ไม่แตะ status / ไม่มี audit ส่งกลับ
    expect(arg.data).not.toHaveProperty('status');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(arg.data.payroll.create.entityScope).toBe('SHOP');
    expect(arg.data.payroll.create.lines.create).toHaveLength(2);
    expect(doc.id).toBe(DOC_ID);
  });

  it('dup-period probe EXCLUDES the doc itself (id not-filter) — editing same period must pass', async () => {
    await service.updatePayroll(DOC_ID, dto, OWNER);
    const probe = prisma.expenseDocument.findFirst.mock.calls[0][0];
    expect(probe.where.id).toEqual({ not: DOC_ID });
    expect(probe.where.payroll).toEqual({ payrollPeriod: '2026-08', entityScope: 'SHOP' });
  });

  it('rejects when another doc already holds the period', async () => {
    prisma.expenseDocument.findFirst.mockResolvedValue({ number: 'PR-2608-999' });
    await expect(service.updatePayroll(DOC_ID, dto, OWNER)).rejects.toThrow(/PR-2608-999/);
    expect(prisma.payrollDetail.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects POSTED / VOIDED / ACCRUAL documents (โพสต์แล้วต้อง VOID)', async () => {
    for (const status of ['POSTED', 'VOIDED', 'ACCRUAL']) {
      prisma.expenseDocument.findUnique.mockResolvedValue(draftDoc({ status }));
      await expect(service.updatePayroll(DOC_ID, dto, OWNER)).rejects.toThrow(/DRAFT/);
    }
    expect(prisma.payrollDetail.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['PENDING_APPROVAL', 'APPROVED'])('editing a %s payroll sends it back to DRAFT (approver cleared) + SENT_BACK_TO_DRAFT audit in the same tx', async (from) => {
    prisma.expenseDocument.findUnique.mockResolvedValue(draftDoc({ status: from, number: 'PR-20260805-0007' }));
    await service.updatePayroll(DOC_ID, dto, OWNER);
    const arg = prisma.expenseDocument.update.mock.calls[0][0];
    expect(arg.data.status).toBe('DRAFT');
    expect(arg.data.approvedById).toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'SENT_BACK_TO_DRAFT',
        entity: 'expense_document',
        entityId: DOC_ID,
        userId: 'u-owner',
        oldValue: { status: from },
        newValue: { status: 'DRAFT', documentNumber: 'PR-20260805-0007', documentType: 'PAYROLL' },
      },
    });
  });

  it('lock order post: → payroll: → payroll-attendance:* and compute excludes the document itself', async () => {
    await service.updatePayroll(DOC_ID, { ...dto, lines: [{ userId: 'emp-1', baseSalary: 13000 }] }, OWNER);
    expect(calls).toEqual([`post:${DOC_ID}`, 'payroll:b1:2026-08:SHOP', 'payroll-attendance:emp-1:2026-08', 'compute:emp-1']);
    expect(systemRows.compute.mock.calls[0][1]).toMatchObject({ excludeDocumentId: DOC_ID, branchId: 'b1', payrollPeriod: '2026-08' });
    const line = prisma.expenseDocument.update.mock.calls[0][0].data.payroll.create.lines.create[0];
    expect(line.netPaid.toFixed(2)).toBe('13162.50');
  });

  it('updatePayrollInTx runs on the caller\'s tx (no nested $transaction) and keeps the given now', async () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    await made.creator.updatePayrollInTx(prisma, DOC_ID, { ...dto, lines: [{ userId: 'emp-1', baseSalary: 13000 }] }, OWNER, now);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(systemRows.compute.mock.calls[0][1].now).toBe(now);
    const line = prisma.expenseDocument.update.mock.calls[0][0].data.payroll.create.lines.create[0];
    expect(line.systemPulledAt).toBe(now);
  });

  it('rejects a BRANCH_MANAGER editing another branch\'s draft', async () => {
    await expect(
      service.updatePayroll(DOC_ID, dto, { id: 'u-bm', branchId: 'b2', role: 'BRANCH_MANAGER' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('keeps the stored entityScope when the dto omits it (FINANCE draft stays FINANCE)', async () => {
    prisma.expenseDocument.findUnique.mockResolvedValue(
      draftDoc({ payroll: { entityScope: 'FINANCE' } }),
    );
    const financeDto = {
      ...dto,
      entityScope: undefined,
      depositAccountCode: '11-1101',
    };
    await service.updatePayroll(DOC_ID, financeDto, OWNER);
    const arg = prisma.expenseDocument.update.mock.calls[0][0];
    expect(arg.data.payroll.create.entityScope).toBe('FINANCE');
  });

  it('scope↔deposit mismatch still rejected in edit mode (SHOP scope + 11-1101)', async () => {
    await expect(
      service.updatePayroll(DOC_ID, { ...dto, depositAccountCode: '11-1101' }, OWNER),
    ).rejects.toThrow(BadRequestException);
  });
});

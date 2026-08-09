/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { makeExpenseDocumentsService } from './support/make-expense-documents-service';

/**
 * R3-2 (2026-08-06) — แก้ไขร่างใบเงินเดือน (PATCH /expense-documents/:id/payroll).
 * DRAFT เท่านั้น, แทนที่ PayrollDetail+lines ทั้งชุด, validator ชุดเดียวกับ create,
 * dup-งวด guard ยกเว้นตัวเอง.
 */
describe('ExpenseDocumentsService.updatePayroll', () => {
  let service: any;
  let prisma: any;

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
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(0),
      expenseDocument: {
        findUnique: jest.fn().mockResolvedValue(draftDoc()),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(async (args: any) => ({ id: DOC_ID, ...args.data })),
      },
      payrollDetail: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    service = makeExpenseDocumentsService({
      prisma,
      ssoConfig: { validateContribution: jest.fn().mockResolvedValue(undefined) },
      payrollCustom: {
        loadWhitelist: jest.fn().mockResolvedValue(new Set(['S52-1202', 'S52-1204'])),
        validateLine: jest.fn().mockResolvedValue({ taxableBase: undefined }),
        validateDeductionAccounts: jest.fn().mockResolvedValue(undefined),
      },
    }).service;
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
    expect(arg.data.withholdingTax.toString()).toBe('200');
    // net = (13000−650) + (19000−875−200) = 12,350 + 17,925 = 30,275
    expect(arg.data.netPayment.toString()).toBe('30275');
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

  it('rejects non-DRAFT documents (โพสต์แล้วต้อง VOID)', async () => {
    prisma.expenseDocument.findUnique.mockResolvedValue(draftDoc({ status: 'POSTED' }));
    await expect(service.updatePayroll(DOC_ID, dto, OWNER)).rejects.toThrow(/DRAFT/);
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

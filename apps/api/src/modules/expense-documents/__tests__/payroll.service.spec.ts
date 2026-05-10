import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExpenseDocumentsService } from '../expense-documents.service';

describe('ExpenseDocumentsService.createPayroll', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docNumber: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({ id: 'pr-1', number: 'PR-20260510-0001' }),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('PR-20260510-0001') };
    const transition: any = {};
    const sameDay: any = {};
    const accrual: any = {};
    const cn: any = {};
    const payroll: any = { execute: jest.fn() };
    const settlement: any = { execute: jest.fn() };
    service = new ExpenseDocumentsService(
      prisma,
      docNumber,
      transition,
      sameDay,
      accrual,
      cn,
      payroll,
      settlement,
      { createAndPost: jest.fn() } as never,
    );
  });

  it('rejects negative netPaid (sso + wht > baseSalary)', async () => {
    await expect(
      service.createPayroll(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          payrollPeriod: '2026-05',
          depositAccountCode: '11-1101',
          lines: [{ employeeName: 'A', baseSalary: 1000, ssoEmployee: 700, whtAmount: 500 }],
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
          { employeeName: 'A', baseSalary: 10000, ssoEmployee: 750, whtAmount: 0 },
          { employeeName: 'B', baseSalary: 15000, ssoEmployee: 750, whtAmount: 300 },
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
  });

  it('rejects non-cross-branch user creating payroll for another branch (ForbiddenException)', async () => {
    await expect(
      service.createPayroll(
        {
          branchId: 'b2',
          documentDate: '2026-05-10',
          payrollPeriod: '2026-05',
          depositAccountCode: '11-1101',
          lines: [{ employeeName: 'A', baseSalary: 5000 }],
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
        lines: [{ employeeName: 'A', baseSalary: 5000 }],
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
        lines: [{ employeeName: 'A', baseSalary: 5000 }],
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

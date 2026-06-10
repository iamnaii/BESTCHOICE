import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { makeExpenseDocumentsService } from './support/make-expense-documents-service';

describe('ExpenseDocumentsService.createPayroll — userId link & snapshot derive', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let created: any;

  const activeEmployee = {
    userId: 'user-emp-1',
    taxIdOverride: null,
    user: { id: 'user-emp-1', name: 'สมชาย ใจดี', nationalId: '1234567890123' },
  };

  beforeEach(() => {
    created = undefined;
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      employeeProfile: {
        findMany: jest.fn().mockResolvedValue([activeEmployee]),
      },
      expenseDocument: {
        create: jest.fn(async (args: any) => {
          created = args;
          return { id: 'pr-1', number: 'PR-20260601-0001' };
        }),
      },
    };
    const docNumber = { next: jest.fn().mockResolvedValue('PR-20260601-0001') };
    service = makeExpenseDocumentsService({
      prisma,
      docNumber,
      transition: {}, // transition
      sameDayTemplate: {}, // sameDay
      accrualTemplate: {}, // accrual
      creditNoteTemplate: {}, // cn
      payrollTemplate: { execute: jest.fn() }, // payroll template
      settlementTemplate: { execute: jest.fn() }, // settlement
      journal: { createAndPost: jest.fn() }, // journalAuto
      jePreview: { preview: jest.fn() }, // jePreview
      ssoConfig: { validateContribution: jest.fn().mockResolvedValue(undefined) }, // ssoConfig
      pettyCashTemplate: { execute: jest.fn() }, // pettyCash template
      pettyCash: { getConfig: jest.fn(), validate: jest.fn() },
      payrollCustom: {
        loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1104', '53-1105'])),
        validateLine: jest.fn().mockResolvedValue({ taxableBase: undefined }),
      }, // payrollCustom
      notifications: { send: jest.fn().mockResolvedValue({ id: 'n-1', status: 'SENT' }) },
    }).service;
  });

  const linesCreated = () =>
    created.data.payroll.create.lines.create as Array<{
      userId: string | null;
      employeeName: string;
      employeeTaxId: string | null;
    }>;

  it('derives employeeName + employeeTaxId from the linked User (ignores client-sent name)', async () => {
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [
          {
            userId: 'user-emp-1',
            employeeName: 'ชื่อปลอมจาก client',
            employeeTaxId: '9999999999999',
            baseSalary: 15000,
            ssoEmployee: 750,
          },
        ],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
    );
    const row = linesCreated()[0];
    expect(row.userId).toBe('user-emp-1');
    expect(row.employeeName).toBe('สมชาย ใจดี');
    expect(row.employeeTaxId).toBe('1234567890123');
  });

  it('uses taxIdOverride when the employee has one', async () => {
    prisma.employeeProfile.findMany.mockResolvedValue([
      { ...activeEmployee, taxIdOverride: '0010000000001' },
    ]);
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ userId: 'user-emp-1', baseSalary: 15000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
    );
    expect(linesCreated()[0].employeeTaxId).toBe('0010000000001');
  });

  it('rejects a userId that is not an active payroll employee', async () => {
    prisma.employeeProfile.findMany.mockResolvedValue([]);
    await expect(
      service.createPayroll(
        {
          branchId: 'b1',
          documentDate: '2026-06-01',
          payrollPeriod: '2026-06',
          depositAccountCode: '11-1101',
          lines: [{ userId: 'ghost', baseSalary: 15000 }],
        } as never,
        { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('legacy path: no userId, keeps client employeeName + taxId, never queries employees', async () => {
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ employeeName: 'พนักงานเก่า', employeeTaxId: '1111111111111', baseSalary: 12000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
    );
    const row = linesCreated()[0];
    expect(row.userId).toBeNull();
    expect(row.employeeName).toBe('พนักงานเก่า');
    expect(row.employeeTaxId).toBe('1111111111111');
    expect(prisma.employeeProfile.findMany).not.toHaveBeenCalled();
  });

  it('rejects a line with neither userId nor employeeName', async () => {
    await expect(
      service.createPayroll(
        {
          branchId: 'b1',
          documentDate: '2026-06-01',
          payrollPeriod: '2026-06',
          depositAccountCode: '11-1101',
          lines: [{ baseSalary: 12000 }],
        } as never,
        { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('masks employeeTaxId in the response for BRANCH_MANAGER (PII)', async () => {
    prisma.expenseDocument.create = jest.fn(async () => ({
      id: 'pr-1',
      number: 'PR-20260601-0001',
      payroll: {
        lines: [{ userId: 'user-emp-1', employeeName: 'สมชาย ใจดี', employeeTaxId: '1234567890123' }],
      },
    }));
    const res: any = await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ userId: 'user-emp-1', baseSalary: 15000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'BRANCH_MANAGER' },
    );
    expect(res.payroll.lines[0].employeeTaxId).toBe('•••••••••0123');
  });

  it('returns full employeeTaxId for FINANCE_MANAGER', async () => {
    prisma.expenseDocument.create = jest.fn(async () => ({
      id: 'pr-1',
      number: 'PR-20260601-0001',
      payroll: {
        lines: [{ userId: 'user-emp-1', employeeName: 'สมชาย ใจดี', employeeTaxId: '1234567890123' }],
      },
    }));
    const res: any = await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ userId: 'user-emp-1', baseSalary: 15000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'FINANCE_MANAGER' },
    );
    expect(res.payroll.lines[0].employeeTaxId).toBe('1234567890123');
  });

  it('returns full employeeTaxId for ACCOUNTANT/OWNER', async () => {
    prisma.expenseDocument.create = jest.fn(async () => ({
      id: 'pr-1',
      number: 'PR-20260601-0001',
      payroll: {
        lines: [{ userId: 'user-emp-1', employeeName: 'สมชาย ใจดี', employeeTaxId: '1234567890123' }],
      },
    }));
    const res: any = await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ userId: 'user-emp-1', baseSalary: 15000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'ACCOUNTANT' },
    );
    expect(res.payroll.lines[0].employeeTaxId).toBe('1234567890123');
  });

  describe('findOne — payroll taxId masking (read path)', () => {
    function mockFindOne() {
      prisma.expenseDocument = {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ documentType: 'PAYROLL', deletedAt: null })
          .mockResolvedValueOnce({
            documentType: 'PAYROLL',
            deletedAt: null,
            payroll: { lines: [{ employeeTaxId: '1234567890123', employeeName: 'สมชาย' }] },
          }),
      };
    }
    it('masks employeeTaxId for BRANCH_MANAGER', async () => {
      mockFindOne();
      const res: any = await service.findOne('doc-1', 'BRANCH_MANAGER');
      expect(res.payroll.lines[0].employeeTaxId).toBe('•••••••••0123');
    });
    it('returns full employeeTaxId for OWNER', async () => {
      mockFindOne();
      const res: any = await service.findOne('doc-1', 'OWNER');
      expect(res.payroll.lines[0].employeeTaxId).toBe('1234567890123');
    });
  });
});

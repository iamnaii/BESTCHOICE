import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ETaxService } from '../e-tax.service';
import { PrismaService } from '../../../prisma/prisma.service';

const Dec = (n: string | number) => new Prisma.Decimal(n);

describe('ETaxService', () => {
  let service: ETaxService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      branch: { findMany: jest.fn() },
      payment: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ETaxService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ETaxService);
    prisma.branch.findMany.mockResolvedValue([{ id: 'br-1' }]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
  });

  it('listInvoices: returns payments with VAT in period (computed base/total)', async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'pay-1',
        paidDate: new Date('2026-05-10'),
        amountPaid: Dec('1070'),
        vatAmount: Dec('70'),
        installmentNo: 1,
        contract: {
          id: 'ct-1',
          contractNumber: 'CT-001',
          customer: { id: 'cu-1', name: 'นายลูกหนี้', nationalId: '1234567890123' },
        },
      },
    ]);
    prisma.payment.count.mockResolvedValue(1);

    const result = await service.listInvoices('co-1', 2026, 5);

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].customerName).toBe('นายลูกหนี้');
    expect(result.data[0].customerTaxId).toBe('1234567890123');
    expect(result.data[0].amountBeforeVat.toString()).toBe('1000');
    expect(result.data[0].vatAmount.toString()).toBe('70');
    expect(result.data[0].total.toString()).toBe('1070');
  });

  it('listInvoices: filters by vatAmount > 0 + status PAID + paidDate in period', async () => {
    await service.listInvoices('co-1', 2026, 5);
    const call = prisma.payment.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('PAID');
    expect(call.where.vatAmount).toEqual({ gt: 0 });
    expect(call.where.paidDate).toHaveProperty('gte');
    expect(call.where.paidDate).toHaveProperty('lte');
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.contract).toMatchObject({
      deletedAt: null,
      branchId: { in: ['br-1'] },
    });
  });

  it('listInvoices: empty company branches → no DB query, empty list', async () => {
    prisma.branch.findMany.mockResolvedValue([]);
    const result = await service.listInvoices('co-empty', 2026, 5);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('exportCsv: returns CSV string with header + BOM', async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'pay-1',
        paidDate: new Date('2026-05-10'),
        amountPaid: Dec('1070'),
        vatAmount: Dec('70'),
        installmentNo: 2,
        contract: {
          id: 'ct-1',
          contractNumber: 'CT-001',
          customer: { id: 'cu-1', name: 'นายลูกหนี้', nationalId: '1234567890123' },
        },
      },
    ]);
    prisma.payment.count.mockResolvedValue(1);

    const csv = await service.exportCsv('co-1', 2026, 5);

    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain('paidDate,installmentNo,contractNumber,customerName,customerTaxId');
    expect(csv).toContain('CT-001');
    expect(csv).toContain('1070.00');
    expect(csv).toContain('70.00');
  });

  it('generateInvoicePdf: returns PDF buffer for PAID payment with VAT (OWNER access)', async () => {
    // Critical #5: PDF requires user context for branch scoping.
    // First call = paymentCheck (just contract.branchId). Then branch lookup.
    // Then full payment fetch with scoped where.
    prisma.payment.findFirst
      .mockResolvedValueOnce({
        contract: { branchId: 'br-1', deletedAt: null },
      })
      .mockResolvedValueOnce({
        id: 'pay-1',
        paidDate: new Date('2026-05-10'),
        installmentNo: 1,
        amountPaid: Dec('1070'),
        vatAmount: Dec('70'),
        contract: {
          id: 'ct-1',
          contractNumber: 'CT-001',
          customer: {
            id: 'cu-1',
            name: 'นายลูกหนี้',
            nationalId: '1234567890123',
            addressIdCard: '1 ถ.พระราม 4 กรุงเทพ',
          },
        },
      });
    // Branch lookup for company resolution
    prisma.branch = {
      findMany: jest.fn().mockResolvedValue([{ id: 'br-1' }]),
      findFirst: jest.fn().mockResolvedValue({ companyId: 'co-1' }),
    };

    const pdf = await service.generateInvoicePdf('pay-1', { role: 'OWNER', branchId: null });
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(500); // smallest legit PDF
    // PDF starts with '%PDF'
    expect(pdf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  // ──────────────────────────────────────────────────────────────────
  // Critical #5: PDF endpoint scoped by branch — close PII leak
  // ──────────────────────────────────────────────────────────────────

  it('Critical #5: BRANCH_MANAGER from branch B cannot fetch branch A payment PDF (NotFoundException)', async () => {
    // Payment belongs to branch A
    prisma.payment.findFirst.mockResolvedValueOnce({
      contract: { branchId: 'br-A', deletedAt: null },
    });
    // branch A is in company co-1
    prisma.branch = {
      findMany: jest.fn().mockResolvedValue([{ id: 'br-A' }, { id: 'br-B' }]),
      findFirst: jest.fn().mockResolvedValue({ companyId: 'co-1' }),
    };

    // BRANCH_MANAGER of branch B — should not be able to fetch
    await expect(
      service.generateInvoicePdf('pay-A', { role: 'BRANCH_MANAGER', branchId: 'br-B' }),
    ).rejects.toThrow('ไม่พบรายการชำระเงิน');
  });

  it('Critical #5: SALES from branch A CAN fetch own branch A payment PDF', async () => {
    prisma.payment.findFirst
      .mockResolvedValueOnce({
        contract: { branchId: 'br-A', deletedAt: null },
      })
      .mockResolvedValueOnce({
        id: 'pay-A',
        paidDate: new Date('2026-05-10'),
        installmentNo: 1,
        amountPaid: Dec('1070'),
        vatAmount: Dec('70'),
        contract: {
          id: 'ct-A',
          contractNumber: 'CT-A',
          customer: { id: 'cu-A', name: 'A', nationalId: null, addressIdCard: null },
        },
      });
    prisma.branch = {
      findMany: jest.fn().mockResolvedValue([{ id: 'br-A' }, { id: 'br-B' }]),
      findFirst: jest.fn().mockResolvedValue({ companyId: 'co-1' }),
    };

    const pdf = await service.generateInvoicePdf('pay-A', {
      role: 'SALES',
      branchId: 'br-A',
    });
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('Critical #5: ACCOUNTANT (cross-branch) CAN fetch any branch payment PDF in their company', async () => {
    prisma.payment.findFirst
      .mockResolvedValueOnce({
        contract: { branchId: 'br-A', deletedAt: null },
      })
      .mockResolvedValueOnce({
        id: 'pay-A',
        paidDate: new Date('2026-05-10'),
        installmentNo: 1,
        amountPaid: Dec('1070'),
        vatAmount: Dec('70'),
        contract: {
          id: 'ct-A',
          contractNumber: 'CT-A',
          customer: { id: 'cu-A', name: 'A', nationalId: null, addressIdCard: null },
        },
      });
    prisma.branch = {
      findMany: jest.fn().mockResolvedValue([{ id: 'br-A' }, { id: 'br-B' }]),
      findFirst: jest.fn().mockResolvedValue({ companyId: 'co-1' }),
    };

    // ACCOUNTANT branchId is irrelevant — cross-branch role sees all branches in company
    const pdf = await service.generateInvoicePdf('pay-A', {
      role: 'ACCOUNTANT',
      branchId: 'br-B',
    });
    expect(pdf).toBeInstanceOf(Buffer);
  });

  it('Critical #5: missing payment returns NotFoundException (no leak of existence)', async () => {
    prisma.payment.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.generateInvoicePdf('pay-doesnotexist', { role: 'OWNER', branchId: null }),
    ).rejects.toThrow('ไม่พบรายการชำระเงิน');
  });

  it('Critical #5: listInvoices respects user branch scoping (BRANCH_MANAGER sees only own branch)', async () => {
    // Company has 2 branches; BRANCH_MANAGER is in br-A only
    prisma.branch.findMany.mockResolvedValue([{ id: 'br-A' }, { id: 'br-B' }]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);

    await service.listInvoices('co-1', 2026, 5, 1, 50, {
      role: 'BRANCH_MANAGER',
      branchId: 'br-A',
    });

    const callWhere = prisma.payment.findMany.mock.calls[0][0].where;
    // Should scope to br-A only, NOT br-A + br-B
    expect(callWhere.contract.branchId.in).toEqual(['br-A']);
    expect(callWhere.contract.branchId.in).not.toContain('br-B');
  });
});

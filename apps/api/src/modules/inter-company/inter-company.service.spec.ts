import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { InterCompanyService } from './inter-company.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T5-C21: fromCompanyId / toCompanyId must never be NULL.
 *
 * The migration seeds stub SHOP/FINANCE CompanyInfo rows so a fresh DB always
 * has them. If they've been soft-deleted at runtime, the service must refuse
 * the tx with a clear Thai error — previously it silently passed `undefined`
 * FKs, which after migration 20260528300000 becomes a DB-level NOT NULL
 * violation (less helpful to the caller).
 */
describe('InterCompanyService — T5-C21 company FK guards', () => {
  let service: InterCompanyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      companyInfo: {
        findFirst: jest.fn(),
      },
      interCompanyTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'ict-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InterCompanyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InterCompanyService>(InterCompanyService);
  });

  const baseDto = {
    saleId: 'sale-1',
    branchId: 'branch-1',
    fromEntity: 'BESTCHOICE FINANCE',
    toEntity: 'BESTCHOICE SHOP',
    principal: 10000,
    commission: 1000,
    commissionPct: 0.1,
    vatAmount: 700,
    vatPct: 0.07,
    totalAmount: 11000,
    interestTotal: 1500,
    costPrice: 8000,
    downPayment: 2000,
    sellingPrice: 12000,
    shopProfit: 3000,
    financeProfit: 500,
  };

  it('throws clear Thai error when FINANCE CompanyInfo is missing', async () => {
    // FINANCE missing, SHOP exists
    prisma.companyInfo.findFirst
      .mockResolvedValueOnce(null) // FINANCE
      .mockResolvedValueOnce({ id: 'shop-co' });

    await expect(service.createFromSale(baseDto as never)).rejects.toThrow(
      InternalServerErrorException,
    );

    await expect(service.createFromSale(baseDto as never)).rejects.toThrow(
      /FINANCE.*CompanyInfo|กรุณาเพิ่มข้อมูลบริษัท/,
    );

    expect(prisma.interCompanyTransaction.create).not.toHaveBeenCalled();
  });

  it('happy path: resolves both FKs and creates transaction with direction detection', async () => {
    prisma.companyInfo.findFirst
      .mockResolvedValueOnce({ id: 'finance-co' }) // FINANCE
      .mockResolvedValueOnce({ id: 'shop-co' });   // SHOP

    await service.createFromSale(baseDto as never);

    expect(prisma.interCompanyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          // fromEntity = "BESTCHOICE FINANCE" → fromCompanyId = finance-co
          fromCompanyId: 'finance-co',
          toCompanyId: 'shop-co',
        }),
      }),
    );
  });
});

/**
 * SP2 — Aging buckets (0-30 / 31-60 / 61-90 / 90+ days from createdAt).
 * Status filter: only PENDING + CONFIRMED — RECONCILED is excluded.
 */
describe('InterCompanyService.getAging (SP2)', () => {
  let service: InterCompanyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      interCompanyTransaction: {
        findMany: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [InterCompanyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<InterCompanyService>(InterCompanyService);
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const txn = (overrides: Record<string, unknown>) => ({
    id: 'tx-' + Math.random().toString(36).slice(2, 8),
    principal: 10000,
    commission: 1000,
    vatAmount: 700,
    interestTotal: 1500,
    totalAmount: 13200,
    status: 'PENDING',
    createdAt: daysAgo(10),
    contractId: 'c-1',
    branchId: 'b-1',
    branch: { name: 'Ladprao' },
    contract: { contractNumber: 'CT-2026-001' },
    ...overrides,
  });

  it('routes txns into the correct bucket (0-30 ≤ 30 days)', async () => {
    prisma.interCompanyTransaction.findMany.mockResolvedValue([
      txn({ createdAt: daysAgo(5) }),
      txn({ createdAt: daysAgo(25) }),
    ]);
    const result = await service.getAging({});
    const b = result.buckets.find((x) => x.range === '0-30');
    expect(b!.count).toBe(2);
    expect(b!.totalAmount).toBeCloseTo(13200 * 2 + 0.01, 1); // principal+commission+interest+vat × 2, rounding tolerance
    // 90+ bucket empty
    expect(result.buckets.find((x) => x.range === '90+')!.count).toBe(0);
  });

  it('routes txns into 90+ bucket when older than 90 days', async () => {
    prisma.interCompanyTransaction.findMany.mockResolvedValue([
      txn({ createdAt: daysAgo(120) }),
      txn({ createdAt: daysAgo(45), status: 'CONFIRMED' }),
      txn({ createdAt: daysAgo(75) }),
    ]);
    const result = await service.getAging({ branchId: 'b-1' });
    expect(result.buckets.find((x) => x.range === '90+')!.count).toBe(1);
    expect(result.buckets.find((x) => x.range === '31-60')!.count).toBe(1);
    expect(result.buckets.find((x) => x.range === '61-90')!.count).toBe(1);
    expect(result.buckets.find((x) => x.range === '0-30')!.count).toBe(0);
    // findMany called with status filter limited to PENDING + CONFIRMED
    const where = prisma.interCompanyTransaction.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['PENDING', 'CONFIRMED'] });
    expect(where.branchId).toBe('b-1');
  });

  // SP2 Critical #5 — settleableAmount = principal + commission only,
  // distinct from totalAmount which bundles interest + VAT.
  it('exposes settleableAmount = principal + commission (excludes interest + VAT)', async () => {
    prisma.interCompanyTransaction.findMany.mockResolvedValue([
      txn({
        principal: 9600,
        commission: 1000,
        interestTotal: 1500,
        vatAmount: 700,
      }),
    ]);
    const result = await service.getAging({});
    expect(result.details).toHaveLength(1);
    const detail = result.details[0];
    expect(detail.settleableAmount).toBeCloseTo(10600, 2);
    // totalAmount still bundles everything (display only)
    expect(detail.totalAmount).toBeCloseTo(9600 + 1000 + 1500 + 700, 2);
    // The two MUST differ — otherwise the settle dialog will overpay
    expect(detail.totalAmount).not.toBe(detail.settleableAmount);
  });

  // SP2 — pagination cap at 500
  it('caps details at 500 rows and flags truncated=true', async () => {
    const many = Array.from({ length: 600 }, (_, i) => txn({ id: `tx-${i}` }));
    prisma.interCompanyTransaction.findMany.mockResolvedValue(many);
    const result = await service.getAging({});
    expect(result.details).toHaveLength(500);
    expect(result.truncated).toBe(true);
    // Bucket totals still reflect the FULL set (not just 500)
    expect(result.totalCount).toBe(600);
  });

  it('does not flag truncated when ≤ 500 rows', async () => {
    const fewer = Array.from({ length: 5 }, (_, i) => txn({ id: `tx-${i}` }));
    prisma.interCompanyTransaction.findMany.mockResolvedValue(fewer);
    const result = await service.getAging({});
    expect(result.details).toHaveLength(5);
    expect(result.truncated).toBe(false);
  });
});

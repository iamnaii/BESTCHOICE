import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InterCompanyService } from '../inter-company/inter-company.service';

/**
 * SalesService unit tests.
 *
 * External utilities (installment calc, config, sequence) are mocked so tests
 * target only SalesService business logic.
 *
 * Coverage:
 *  - findAll      : soft-delete filter, saleType/branch/search filters, pagination,
 *                   OWNER profit visibility vs. non-OWNER cost stripping
 *  - findOne      : not-found, soft-deleted
 *  - create (CASH): payment-method guard, product-in-stock guard, commission from rule
 *  - create (INSTALLMENT): down-payment guard, totalMonths guard, contract + schedule
 *                           creation, product reservation, inter-company tx, finance receivable
 *  - create (EXTERNAL_FINANCE): finance-company guard, product marked SOLD_INSTALLMENT,
 *                                finance receivable created
 *  - getSalespersons: role-based branch scoping
 */

// ─── module-level mocks ───────────────────────────────────────────────────────

jest.mock('../../utils/installment.util', () => ({
  calculateInstallment: jest.fn().mockReturnValue({
    principal: 18000,
    interestTotal: 1728,
    storeCommission: 1800,
    vatAmount: 226.08,
    financedAmount: 21754.08,
    monthlyPayment: 1813,
  }),
  generatePaymentSchedule: jest.fn().mockReturnValue([
    { contractId: 'contract-1', installmentNo: 1, amountDue: 1813, dueDate: new Date(), status: 'PENDING' },
  ]),
}));

jest.mock('../../utils/config.util', () => ({
  loadInstallmentConfig: jest.fn().mockResolvedValue({
    interestRate: 0.08,
    minDownPaymentPct: 0.15,
    minInstallmentMonths: 6,
    maxInstallmentMonths: 12,
    storeCommissionPct: 0.10,
    vatPct: 0.07,
  }),
  resolveInstallmentParams: jest.fn().mockReturnValue({
    interestRate: 0.08,
    minDownPaymentPct: 0.15,
    minInstallmentMonths: 6,
    maxInstallmentMonths: 12,
    storeCommissionPct: 0.10,
    vatPct: 0.07,
  }),
}));

jest.mock('../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('BC-2026-TEST-001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
}));

// ─── test suite ──────────────────────────────────────────────────────────────

describe('SalesService', () => {
  let service: SalesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let interCompanyService: any;

  // ─── fixtures ──────────────────────────────────────────────────────────────

  const mockProduct = {
    id: 'product-1',
    name: 'Samsung Galaxy S25',
    brand: 'Samsung',
    model: 'Galaxy S25',
    category: 'SMARTPHONE',
    status: 'IN_STOCK',
    imeiSerial: '987654321012345',
    costPrice: new Prisma.Decimal(18000),
    deletedAt: null,
  };

  const mockSale = {
    id: 'sale-1',
    saleNumber: 'SL000001',
    saleType: 'CASH',
    customerId: 'customer-1',
    productId: 'product-1',
    branchId: 'branch-1',
    salespersonId: 'user-1',
    sellingPrice: new Prisma.Decimal(25000),
    discount: new Prisma.Decimal(0),
    netAmount: new Prisma.Decimal(25000),
    paymentMethod: 'CASH',
    amountReceived: new Prisma.Decimal(25000),
    downPaymentAmount: null,
    contractId: null,
    financeCompany: null,
    financeRefNumber: null,
    financeAmount: null,
    bundleProductIds: [],
    notes: null,
    deletedAt: null,
    customer: { id: 'customer-1', name: 'สมหญิง ใจดี', phone: '0891234567' },
    product: {
      id: 'product-1',
      name: 'Samsung Galaxy S25',
      brand: 'Samsung',
      model: 'Galaxy S25',
      imeiSerial: '987654321012345',
      serialNumber: null,
      costPrice: new Prisma.Decimal(18000),
    },
    branch: { id: 'branch-1', name: 'สาขาลาดพร้าว' },
    salesperson: { id: 'user-1', name: 'พนักงาน 1' },
    contract: null,
  };

  const mockCommissionRule = {
    id: 'cr-1',
    isActive: true,
    deletedAt: null,
    rate: new Prisma.Decimal(0.025), // 2.5% — not the hardcoded 3% fallback
    createdAt: new Date(),
  };

  // ─── beforeEach ────────────────────────────────────────────────────────────

  beforeEach(async () => {
    prisma = {
      sale: {
        findMany: jest.fn().mockResolvedValue([mockSale]),
        findUnique: jest.fn().mockResolvedValue(mockSale),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { netAmount: new Prisma.Decimal(25000), discount: new Prisma.Decimal(0) } }),
        groupBy: jest.fn().mockResolvedValue([
          { saleType: 'CASH', _count: 1, _sum: { netAmount: new Prisma.Decimal(25000) } },
        ]),
        create: jest.fn().mockResolvedValue(mockSale),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
        findMany: jest.fn().mockResolvedValue([mockProduct]),
        update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'SOLD_CASH' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      interestConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      contract: {
        create: jest.fn().mockResolvedValue({
          id: 'contract-1',
          contractNumber: 'BC-2026-TEST-001',
          totalMonths: 12,
        }),
      },
      payment: {
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
      },
      salesCommission: {
        create: jest.fn().mockResolvedValue({}),
      },
      commissionRule: {
        findFirst: jest.fn().mockResolvedValue(mockCommissionRule),
      },
      financeReceivable: {
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'user-1', name: 'พนักงาน 1' }]),
      },
      systemConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation(
        async (fnOrArray: unknown, _opts?: unknown) => {
          if (typeof fnOrArray === 'function') {
            return (fnOrArray as (tx: unknown) => Promise<unknown>)(prisma);
          }
          return Promise.all(fnOrArray as Promise<unknown>[]);
        },
      ),
    };

    interCompanyService = {
      createFromSaleInTx: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: prisma },
        { provide: InterCompanyService, useValue: interCompanyService },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findAll
  // ─────────────────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('always includes deletedAt: null to exclude soft-deleted sales', async () => {
      await service.findAll({});
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
    });

    it('filters by saleType when provided', async () => {
      await service.findAll({ saleType: 'CASH' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.saleType).toBe('CASH');
    });

    it('filters by branchId when provided', async () => {
      await service.findAll({ branchId: 'branch-99' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.branchId).toBe('branch-99');
    });

    it('builds OR search across saleNumber, customer name, product name, and finance fields', async () => {
      await service.findAll({ search: 'SL000' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeDefined();
      expect(where.OR.length).toBeGreaterThanOrEqual(2);
    });

    it('applies date range filter when startDate and endDate are provided', async () => {
      await service.findAll({ startDate: '2026-01-01', endDate: '2026-01-31' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      const createdAt = where.createdAt as Record<string, Date>;
      expect(createdAt.gte).toBeInstanceOf(Date);
      expect(createdAt.lte).toBeInstanceOf(Date);
    });

    it('defaults to page 1 and limit 50', async () => {
      await service.findAll({});
      const call = prisma.sale.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(50);
    });

    it('strips costPrice from product data for non-OWNER roles', async () => {
      const result = await service.findAll({ userRole: 'SALES' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstProduct = (result.data[0] as any).product;
      expect(firstProduct).not.toHaveProperty('costPrice');
    });

    it('keeps costPrice in product data for OWNER role', async () => {
      const result = await service.findAll({ userRole: 'OWNER' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstProduct = (result.data[0] as any).product;
      expect(firstProduct).toHaveProperty('costPrice');
    });

    it('calculates totalProfit only for OWNER role (non-OWNER gets 0)', async () => {
      const ownerResult = await service.findAll({ userRole: 'OWNER' });
      const salesResult = await service.findAll({ userRole: 'SALES' });

      // OWNER: profit = netAmount - costPrice per sale
      expect(typeof ownerResult.summary.totalProfit).toBe('number');
      // SALES: no profit exposure
      expect(salesResult.summary.totalProfit).toBe(0);
    });

    it('includes a summary with cash/installment/finance counts', async () => {
      prisma.sale.groupBy.mockResolvedValue([
        { saleType: 'CASH', _count: 3, _sum: { netAmount: new Prisma.Decimal(75000) } },
        { saleType: 'INSTALLMENT', _count: 2, _sum: { netAmount: new Prisma.Decimal(40000) } },
        { saleType: 'EXTERNAL_FINANCE', _count: 1, _sum: { netAmount: new Prisma.Decimal(20000) } },
      ]);

      const result = await service.findAll({});

      expect(result.summary.cashCount).toBe(3);
      expect(result.summary.installmentCount).toBe(2);
      expect(result.summary.financeCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findOne
  // ─────────────────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the sale when it exists', async () => {
      const result = await service.findOne('sale-1');
      expect(result.id).toBe('sale-1');
    });

    it('throws NotFoundException when sale does not exist', async () => {
      prisma.sale.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when sale is soft-deleted', async () => {
      prisma.sale.findUnique.mockResolvedValue({ ...mockSale, deletedAt: new Date() });
      await expect(service.findOne('sale-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // create — CASH sale
  // ─────────────────────────────────────────────────────────────────────────────

  describe('create — CASH', () => {
    const cashDto = {
      saleType: 'CASH' as const,
      customerId: 'customer-1',
      productId: 'product-1',
      branchId: 'branch-1',
      sellingPrice: 25000,
      paymentMethod: 'CASH',
    };

    it('throws BadRequestException when paymentMethod is missing', async () => {
      await expect(
        service.create({ ...cashDto, paymentMethod: undefined }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when product is not IN_STOCK', async () => {
      // Simulate product already sold inside transaction
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              ...prisma.product,
              findUnique: jest.fn().mockResolvedValue({ ...mockProduct, status: 'SOLD_CASH' }),
            },
          };
          return fn(txPrisma);
        },
      );
      await expect(service.create(cashDto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks the product SOLD_CASH after a successful cash sale', async () => {
      let updateCalled = false;
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              ...prisma.product,
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              update: jest.fn().mockImplementation((args: { data: { status: string } }) => {
                if (args.data.status === 'SOLD_CASH') updateCalled = true;
                return Promise.resolve({ ...mockProduct, status: 'SOLD_CASH' });
              }),
            },
            sale: { create: jest.fn().mockResolvedValue(mockSale) },
            salesCommission: { create: jest.fn().mockResolvedValue({}) },
            commissionRule: { findFirst: jest.fn().mockResolvedValue(mockCommissionRule) },
          };
          return fn(txPrisma);
        },
      );

      await service.create(cashDto, 'user-1');
      expect(updateCalled).toBe(true);
    });

    it('reads commission rate from CommissionRule (not hardcoded 3%)', async () => {
      let capturedCommissionRate: number | undefined;
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'SOLD_CASH' }),
            },
            sale: { create: jest.fn().mockResolvedValue(mockSale) },
            salesCommission: {
              create: jest.fn().mockImplementation((args: { data: { commissionRate: number } }) => {
                capturedCommissionRate = args.data.commissionRate;
                return Promise.resolve({});
              }),
            },
            commissionRule: {
              findFirst: jest.fn().mockResolvedValue({ ...mockCommissionRule, rate: new Prisma.Decimal(0.025) }),
            },
          };
          return fn(txPrisma);
        },
      );

      await service.create(cashDto, 'user-1');
      // Should use 0.025 from rule, not the fallback 0.03
      expect(capturedCommissionRate).toBe(0.025);
    });

    it('falls back to 3% commission when no active CommissionRule exists', async () => {
      let capturedCommissionRate: number | undefined;
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'SOLD_CASH' }),
            },
            sale: { create: jest.fn().mockResolvedValue(mockSale) },
            salesCommission: {
              create: jest.fn().mockImplementation((args: { data: { commissionRate: number } }) => {
                capturedCommissionRate = args.data.commissionRate;
                return Promise.resolve({});
              }),
            },
            commissionRule: { findFirst: jest.fn().mockResolvedValue(null) }, // no rule
          };
          return fn(txPrisma);
        },
      );

      await service.create(cashDto, 'user-1');
      expect(capturedCommissionRate).toBe(0.03); // hardcoded fallback
    });

    it('throws BadRequestException when a bundle product is not IN_STOCK', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              findMany: jest.fn().mockResolvedValue([
                { id: 'bundle-1', status: 'SOLD_CASH', name: 'เคส' },
              ]),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
          };
          return fn(txPrisma);
        },
      );

      await expect(
        service.create({ ...cashDto, bundleProductIds: ['bundle-1'] }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // create — INSTALLMENT sale
  // ─────────────────────────────────────────────────────────────────────────────

  describe('create — INSTALLMENT', () => {
    const installmentDto = {
      saleType: 'INSTALLMENT' as const,
      customerId: 'customer-1',
      productId: 'product-1',
      branchId: 'branch-1',
      sellingPrice: 20000,
      downPayment: 3500,   // > 15% min
      totalMonths: 12,
      paymentMethod: 'CASH',
    };

    it('throws BadRequestException when downPayment is not provided', async () => {
      await expect(
        service.create({ ...installmentDto, downPayment: undefined }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when totalMonths is not provided', async () => {
      await expect(
        service.create({ ...installmentDto, totalMonths: undefined }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when downPayment is below the minimum percentage', async () => {
      // Min is 15% of netAmount (20000) = 3000; 2500 is below that
      await expect(
        service.create({ ...installmentDto, downPayment: 2500 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when totalMonths is out of range', async () => {
      await expect(
        service.create({ ...installmentDto, totalMonths: 3 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a contract, payment schedule, and reserves the product', async () => {
      let contractCreated = false;
      let paymentsCreated = false;
      let productReserved = false;

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockImplementation((args: { data: { status: string } }) => {
                if (args.data.status === 'RESERVED') productReserved = true;
                return Promise.resolve({ ...mockProduct, status: args.data.status });
              }),
            },
            contract: {
              create: jest.fn().mockImplementation(() => {
                contractCreated = true;
                return Promise.resolve({ id: 'contract-1', contractNumber: 'BC-2026-TEST-001', totalMonths: 12 });
              }),
            },
            payment: {
              createMany: jest.fn().mockImplementation(() => {
                paymentsCreated = true;
                return Promise.resolve({ count: 12 });
              }),
            },
            sale: { create: jest.fn().mockResolvedValue({ ...mockSale, saleType: 'INSTALLMENT' }) },
            salesCommission: { create: jest.fn().mockResolvedValue({}) },
            commissionRule: { findFirst: jest.fn().mockResolvedValue(mockCommissionRule) },
            financeReceivable: { create: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );

      await service.create(installmentDto, 'user-1');

      expect(contractCreated).toBe(true);
      expect(paymentsCreated).toBe(true);
      expect(productReserved).toBe(true);
    });

    it('creates an inter-company transaction for BESTCHOICE SHOP ↔ FINANCE flow', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'RESERVED' }),
            },
            contract: {
              create: jest.fn().mockResolvedValue({ id: 'contract-1', contractNumber: 'BC-2026-TEST-001', totalMonths: 12 }),
            },
            payment: { createMany: jest.fn().mockResolvedValue({ count: 12 }) },
            sale: { create: jest.fn().mockResolvedValue({ ...mockSale, saleType: 'INSTALLMENT' }) },
            salesCommission: { create: jest.fn().mockResolvedValue({}) },
            commissionRule: { findFirst: jest.fn().mockResolvedValue(mockCommissionRule) },
            financeReceivable: { create: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );

      await service.create(installmentDto, 'user-1');
      expect(interCompanyService.createFromSaleInTx).toHaveBeenCalled();
    });

    it('creates a FinanceReceivable for the BESTCHOICE FINANCE entity', async () => {
      let financeReceivableCreated = false;

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'RESERVED' }),
            },
            contract: {
              create: jest.fn().mockResolvedValue({ id: 'contract-1', contractNumber: 'BC-2026-TEST-001', totalMonths: 12 }),
            },
            payment: { createMany: jest.fn().mockResolvedValue({ count: 12 }) },
            sale: { create: jest.fn().mockResolvedValue({ ...mockSale, saleType: 'INSTALLMENT' }) },
            salesCommission: { create: jest.fn().mockResolvedValue({}) },
            commissionRule: { findFirst: jest.fn().mockResolvedValue(mockCommissionRule) },
            financeReceivable: {
              create: jest.fn().mockImplementation(() => {
                financeReceivableCreated = true;
                return Promise.resolve({});
              }),
            },
          };
          return fn(txPrisma);
        },
      );

      await service.create(installmentDto, 'user-1');
      expect(financeReceivableCreated).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // create — EXTERNAL_FINANCE sale
  // ─────────────────────────────────────────────────────────────────────────────

  describe('create — EXTERNAL_FINANCE', () => {
    const extFinanceDto = {
      saleType: 'EXTERNAL_FINANCE' as const,
      customerId: 'customer-1',
      productId: 'product-1',
      branchId: 'branch-1',
      sellingPrice: 25000,
      paymentMethod: 'BANK_TRANSFER',
      financeCompany: 'GFIN',
      financeAmount: 20000,
      downPayment: 5000,
    };

    it('throws BadRequestException when financeCompany is not provided', async () => {
      await expect(
        service.create({ ...extFinanceDto, financeCompany: undefined }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks the product as SOLD_INSTALLMENT after an external finance sale', async () => {
      let productStatus: string | undefined;

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockImplementation((args: { data: { status: string } }) => {
                productStatus = args.data.status;
                return Promise.resolve({ ...mockProduct, status: args.data.status });
              }),
            },
            sale: { create: jest.fn().mockResolvedValue({ ...mockSale, saleType: 'EXTERNAL_FINANCE' }) },
            financeReceivable: { create: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );

      await service.create(extFinanceDto, 'user-1');
      expect(productStatus).toBe('SOLD_INSTALLMENT');
    });

    it('creates a FinanceReceivable tracking expected payment from finance company', async () => {
      let financeReceivableArgs: Record<string, unknown> | undefined;

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'SOLD_INSTALLMENT' }),
            },
            sale: { create: jest.fn().mockResolvedValue({ ...mockSale, saleType: 'EXTERNAL_FINANCE' }) },
            financeReceivable: {
              create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
                financeReceivableArgs = args.data;
                return Promise.resolve({});
              }),
            },
          };
          return fn(txPrisma);
        },
      );

      await service.create(extFinanceDto, 'user-1');

      expect(financeReceivableArgs).toBeDefined();
      expect(financeReceivableArgs?.financeCompany).toBe('GFIN');
      expect(Number(financeReceivableArgs?.expectedAmount)).toBe(20000);
    });

    it('throws BadRequestException when the main product is not IN_STOCK', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              findUnique: jest.fn().mockResolvedValue({ ...mockProduct, status: 'SOLD_CASH' }),
              findMany: jest.fn().mockResolvedValue([]),
            },
          };
          return fn(txPrisma);
        },
      );

      await expect(service.create(extFinanceDto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getSalespersons
  // ─────────────────────────────────────────────────────────────────────────────

  describe('getSalespersons', () => {
    it('returns all active salespersons for OWNER role (no branch filter)', async () => {
      await service.getSalespersons({ role: 'OWNER' });
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.branchId).toBeUndefined();
    });

    it('filters salespersons by branchId for BRANCH_MANAGER role', async () => {
      await service.getSalespersons({ role: 'BRANCH_MANAGER', branchId: 'branch-1' });
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.branchId).toBe('branch-1');
    });

    it('always filters for active (non-deleted) users', async () => {
      await service.getSalespersons({ role: 'SALES' });
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(true);
      expect(where.deletedAt).toBeNull();
    });
  });
});

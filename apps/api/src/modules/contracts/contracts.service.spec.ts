import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ContractsService unit tests.
 *
 * All external utilities (installment calc, config, sequence, validation) are
 * mocked so tests exercise only ContractsService business logic.
 *
 * Coverage:
 *  - findAll   : soft-delete filter, status/branch/search filters, pagination, summary block
 *  - findOne   : not-found, soft-deleted, branch-access enforcement
 *  - create    : product guards, IMEI guard, down-payment bounds, totalMonths range,
 *                credit-check requirement, product reservation, payment schedule creation
 *  - update    : workflow-status guard, creator-only guard, financial-change-after-payment guard
 *  - softDelete: ACTIVE guard, signature guard, success path
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
  calculateInstallmentWithInterest: jest.fn().mockReturnValue({
    principal: 18000,
    interestTotal: 1728,
    storeCommission: 1800,
    vatAmount: 226.08,
    financedAmount: 21754.08,
    monthlyPayment: 1813,
  }),
  roundBaht: jest.fn().mockImplementation((v: number) => Math.round(v * 100) / 100),
  generatePaymentSchedule: jest.fn().mockReturnValue([
    { contractId: 'contract-1', installmentNo: 1, amountDue: 1813, dueDate: new Date(), status: 'PENDING' },
  ]),
}));

jest.mock('../../utils/get-rate-for-months.util', () => ({
  getRateForMonths: jest.fn().mockResolvedValue(0.96),
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
  resolveVatPctForBranch: jest.fn().mockResolvedValue(0.07),
}));

jest.mock('../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('BC-2026-TEST-001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
}));

jest.mock('../../utils/validation.util', () => ({
  validateIMEI: jest.fn().mockReturnValue(true),
  validateThaiPhone: jest.fn().mockReturnValue(true),
  checkAgeEligibility: jest.fn().mockReturnValue({ eligible: true, requiresGuardian: false }),
  validateAddress: jest.fn().mockReturnValue(true),
  checkRequiredContractFields: jest.fn().mockReturnValue([]),
  checkRequiredDocuments: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
  checkRequiredSignatures: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
}));

// ─── test suite ──────────────────────────────────────────────────────────────

describe('ContractsService', () => {
  let service: ContractsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  // ─── fixtures ──────────────────────────────────────────────────────────────

  const mockProduct = {
    id: 'product-1',
    name: 'iPhone 15',
    brand: 'Apple',
    model: 'iPhone 15',
    category: 'SMARTPHONE',
    status: 'IN_STOCK',
    imeiSerial: '123456789012345',
    costPrice: new Prisma.Decimal(20000),
    deletedAt: null,
    prices: [],
  };

  const mockInterestConfig = {
    id: 'ic-1',
    isActive: true,
    deletedAt: null,
    productCategories: ['SMARTPHONE'],
    interestRate: new Prisma.Decimal(0.08),
    minDownPaymentPct: new Prisma.Decimal(0.15),
    storeCommissionPct: new Prisma.Decimal(0.10),
    vatPct: new Prisma.Decimal(0.07),
    minInstallmentMonths: 6,
    maxInstallmentMonths: 12,
  };

  const mockCustomer = {
    id: 'customer-1',
    name: 'สมชาย ใจดี',
    phone: '0891234567',
    nationalId: '1234567890123',
    prefix: 'นาย',
    nickname: null,
    phoneSecondary: null,
    email: null,
    lineIdFinance: null,
    lineIdShop: null,
    occupation: null,
    salary: null,
    workplace: null,
    addressIdCard: 'กรุงเทพ',
    addressCurrent: 'กรุงเทพ',
    addressWork: null,
    references: [],
    birthDate: null,
    facebookLink: null,
    facebookName: null,
    googleMapLink: null,
    guardianName: null,
    deletedAt: null,
  };

  const mockContract = {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customerId: 'customer-1',
    productId: 'product-1',
    branchId: 'branch-1',
    salespersonId: 'user-1',
    status: 'DRAFT',
    workflowStatus: 'CREATING',
    sellingPrice: new Prisma.Decimal(20000),
    downPayment: new Prisma.Decimal(3000), // exactly 15% — satisfies minDownPaymentPct=0.15
    totalMonths: 12,
    interestRate: new Prisma.Decimal(0.08),
    interestTotal: new Prisma.Decimal(1728),
    financedAmount: new Prisma.Decimal(21754.08),
    storeCommission: new Prisma.Decimal(1800),
    vatAmount: new Prisma.Decimal(226.08),
    vatPct: new Prisma.Decimal(0.07),
    monthlyPayment: new Prisma.Decimal(1813),
    paymentDueDay: 5,
    interestConfigId: 'ic-1',
    notes: null,
    deletedAt: null,
    pdpaConsentId: null,
    planType: 'STORE_DIRECT',
    customer: mockCustomer,
    product: { ...mockProduct, prices: [] },
    branch: { id: 'branch-1', name: 'สาขาลาดพร้าว' },
    salesperson: { id: 'user-1', name: 'พนักงาน 1' },
    reviewedBy: null,
    interestConfig: mockInterestConfig,
    payments: [],
    signatures: [],
    eDocuments: [],
    contractDocuments: [],
    creditCheck: null,
  };

  // ─── base transaction mock — executes callback with prisma itself ───────────
  const makeTxMock = (overrides: Record<string, unknown> = {}) =>
    jest.fn().mockImplementation(async (fnOrArray: unknown) => {
      if (typeof fnOrArray === 'function') {
        return fnOrArray({ ...prisma, ...overrides });
      }
      return Promise.all(fnOrArray as Promise<unknown>[]);
    });

  // ─── beforeEach ────────────────────────────────────────────────────────────

  beforeEach(async () => {
    prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
        update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'RESERVED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      interestConfig: {
        findFirst: jest.fn().mockResolvedValue(mockInterestConfig),
        findUnique: jest.fn().mockResolvedValue(mockInterestConfig),
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([mockContract]),
        findUnique: jest.fn().mockResolvedValue(mockContract),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { sellingPrice: new Prisma.Decimal(20000) } }),
        create: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue(mockContract),
      },
      payment: {
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      creditCheck: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cc-1', status: 'APPROVED', contractId: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      kycVerification: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue(mockCustomer),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'SALES' }),
      },
      systemConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      signature: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: makeTxMock(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findAll
  // ─────────────────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('always includes deletedAt: null to exclude soft-deleted contracts', async () => {
      await service.findAll({});
      const where = prisma.contract.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
    });

    it('filters by status when provided', async () => {
      await service.findAll({ status: 'ACTIVE' });
      const where = prisma.contract.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('ACTIVE');
    });

    it('filters by branchId when provided', async () => {
      await service.findAll({ branchId: 'branch-99' });
      const where = prisma.contract.findMany.mock.calls[0][0].where;
      expect(where.branchId).toBe('branch-99');
    });

    it('builds OR search across contractNumber and customer name', async () => {
      await service.findAll({ search: 'สมชาย' });
      const where = prisma.contract.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeDefined();
      expect(where.OR).toHaveLength(2);
    });

    it('applies date range filter when startDate + endDate are provided', async () => {
      await service.findAll({ startDate: '2026-01-01', endDate: '2026-01-31' });
      const where = prisma.contract.findMany.mock.calls[0][0].where;
      const createdAt = where.createdAt as Record<string, Date>;
      expect(createdAt.gte).toBeInstanceOf(Date);
      expect(createdAt.lte).toBeInstanceOf(Date);
    });

    it('defaults to page 1 and limit 50', async () => {
      await service.findAll({});
      const call = prisma.contract.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(50);
    });

    it('caps limit at 100 regardless of what is passed', async () => {
      await service.findAll({ limit: 999 });
      const call = prisma.contract.findMany.mock.calls[0][0];
      expect(call.take).toBe(100);
    });

    it('returns a summary block alongside paginated data', async () => {
      prisma.contract.count
        .mockResolvedValueOnce(5)   // total
        .mockResolvedValueOnce(3)   // activeContracts
        .mockResolvedValueOnce(1);  // overdueContracts
      prisma.contract.aggregate.mockResolvedValue({
        _sum: { sellingPrice: new Prisma.Decimal(150000) },
      });

      const result = await service.findAll({});

      expect(result.summary.totalContracts).toBe(5);
      expect(result.summary.activeContracts).toBe(3);
      expect(result.summary.overdueContracts).toBe(1);
      expect(result.summary.portfolioValue).toBe(150000);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findOne
  // ─────────────────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the contract when it exists', async () => {
      const result = await service.findOne('contract-1');
      expect(result.id).toBe('contract-1');
    });

    it('throws NotFoundException when contract does not exist', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when contract is soft-deleted', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        deletedAt: new Date(),
      });
      await expect(service.findOne('contract-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when SALES user accesses a different-branch contract', async () => {
      const user = { id: 'user-2', role: 'SALES', branchId: 'branch-99' };
      await expect(service.findOne('contract-1', user)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows OWNER to access any branch contract', async () => {
      const owner = { id: 'owner-1', role: 'OWNER', branchId: null };
      const result = await service.findOne('contract-1', owner);
      expect(result.id).toBe('contract-1');
    });

    it('allows a SALES user whose branchId matches the contract branch', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-1' };
      const result = await service.findOne('contract-1', user);
      expect(result.id).toBe('contract-1');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // create
  // ─────────────────────────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = {
      customerId: 'customer-1',
      productId: 'product-1',
      branchId: 'branch-1',
      sellingPrice: 20000,
      downPayment: 3500, // 17.5% — above default 15% min
      totalMonths: 12,
    };

    // The active-contract guard runs before all create-path validations.
    // Default mock to "no active contracts" so these tests exercise downstream logic.
    beforeEach(() => {
      prisma.contract.findMany.mockResolvedValue([]);
    });

    it('throws BadRequestException when product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.create(validDto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when product is soft-deleted', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        deletedAt: new Date(),
      });
      await expect(service.create(validDto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when product status is not IN_STOCK', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        status: 'RESERVED',
      });
      await expect(service.create(validDto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when product has no IMEI/Serial', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        imeiSerial: null,
      });
      await expect(service.create(validDto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when downPayment >= sellingPrice', async () => {
      await expect(
        service.create({ ...validDto, downPayment: 20000 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when downPayment is negative', async () => {
      await expect(
        service.create({ ...validDto, downPayment: -1 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when totalMonths is below the minimum allowed', async () => {
      // resolveInstallmentParams mocked to return min=6, so 3 is invalid
      await expect(
        service.create({ ...validDto, totalMonths: 3 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when totalMonths exceeds the maximum allowed', async () => {
      await expect(
        service.create({ ...validDto, totalMonths: 24 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when paymentDueDay is in the invalid 29-30 range', async () => {
      await expect(
        service.create({ ...validDto, paymentDueDay: 29 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when no approved credit check exists', async () => {
      prisma.creditCheck.findFirst.mockResolvedValue(null);
      await expect(service.create(validDto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when product is already taken inside the transaction', async () => {
      // Product looks fine before tx, but RESERVED when re-checked atomically
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              ...prisma.product,
              findUnique: jest.fn().mockResolvedValue({ ...mockProduct, status: 'RESERVED' }),
            },
            creditCheck: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'cc-1',
                status: 'APPROVED',
                contractId: null,
              }),
            },
            customer: { findUnique: jest.fn().mockResolvedValue(mockCustomer) },
          };
          return fn(txPrisma);
        },
      );
      await expect(service.create(validDto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a contract and generates a payment schedule on success', async () => {
       
      let paymentCreateManyCalled = false;

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              ...prisma.product,
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'RESERVED' }),
            },
            creditCheck: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'cc-1',
                status: 'APPROVED',
                contractId: null,
              }),
              update: jest.fn().mockResolvedValue({}),
            },
            customer: { findUnique: jest.fn().mockResolvedValue(mockCustomer) },
            contract: {
              create: jest.fn().mockResolvedValue(mockContract),
            },
            payment: {
              createMany: jest.fn().mockImplementation(() => {
                paymentCreateManyCalled = true;
                return Promise.resolve({ count: 12 });
              }),
            },
          };
          return fn(txPrisma);
        },
      );

      const result = await service.create(validDto, 'user-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('contract-1');
      expect(paymentCreateManyCalled).toBe(true);
    });

    it('reserves the product after a successful contract creation', async () => {
      let productUpdateCalled = false;

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            product: {
              ...prisma.product,
              findUnique: jest.fn().mockResolvedValue(mockProduct),
              update: jest.fn().mockImplementation((args: { data: { status: string } }) => {
                if (args.data.status === 'RESERVED') productUpdateCalled = true;
                return Promise.resolve({ ...mockProduct, status: 'RESERVED' });
              }),
            },
            creditCheck: {
              findFirst: jest.fn().mockResolvedValue({ id: 'cc-1', status: 'APPROVED', contractId: null }),
              update: jest.fn().mockResolvedValue({}),
            },
            customer: { findUnique: jest.fn().mockResolvedValue(mockCustomer) },
            contract: { create: jest.fn().mockResolvedValue(mockContract) },
            payment: { createMany: jest.fn().mockResolvedValue({ count: 12 }) },
          };
          return fn(txPrisma);
        },
      );

      await service.create(validDto, 'user-1');
      expect(productUpdateCalled).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // update
  // ─────────────────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws BadRequestException when workflowStatus is not CREATING or REJECTED', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        workflowStatus: 'SUBMITTED',
      });

      await expect(
        service.update('contract-1', { notes: 'test' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ForbiddenException when a non-OWNER user edits another person\'s contract', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        salespersonId: 'other-user',
        workflowStatus: 'CREATING',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'SALES' });

      await expect(
        service.update('contract-1', { notes: 'test' }, 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows OWNER to edit any contract regardless of salespersonId', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        salespersonId: 'other-user',
        workflowStatus: 'CREATING',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'OWNER' });

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            payment: {
              count: jest.fn().mockResolvedValue(0),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              createMany: jest.fn().mockResolvedValue({ count: 12 }),
            },
            contract: { update: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );
      // findOne called a second time after update — mock to return contract again
      prisma.contract.findUnique
        .mockResolvedValueOnce({ ...mockContract, salespersonId: 'other-user', workflowStatus: 'CREATING' })
        .mockResolvedValueOnce(mockContract);

      await expect(
        service.update('contract-1', { notes: 'owner edit' }, 'owner-1'),
      ).resolves.toBeDefined();
    });

    it('throws BadRequestException when financial fields are changed after payments exist', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        salespersonId: 'user-1',
        workflowStatus: 'CREATING',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'SALES' });

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            payment: {
              count: jest.fn().mockResolvedValue(3), // 3 paid installments
              updateMany: jest.fn(),
              createMany: jest.fn(),
            },
            contract: { update: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );

      await expect(
        service.update('contract-1', { sellingPrice: 25000 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows non-financial updates (notes only) when payments exist', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        salespersonId: 'user-1',
        workflowStatus: 'CREATING',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'SALES' });

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            payment: {
              count: jest.fn().mockResolvedValue(3),
              updateMany: jest.fn(),
              createMany: jest.fn(),
            },
            contract: { update: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );
      prisma.contract.findUnique
        .mockResolvedValueOnce({ ...mockContract, salespersonId: 'user-1', workflowStatus: 'CREATING' })
        .mockResolvedValueOnce(mockContract); // for final findOne

      await expect(
        service.update('contract-1', { notes: 'เพิ่มหมายเหตุ' }, 'user-1'),
      ).resolves.toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // softDelete
  // ─────────────────────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('throws BadRequestException when the contract is ACTIVE', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'ACTIVE',
        workflowStatus: 'APPROVED',
        signatures: [],
      });

      await expect(service.softDelete('contract-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when workflowStatus is SUBMITTED (not CREATING/REJECTED)', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DRAFT',
        workflowStatus: 'SUBMITTED',
        signatures: [],
      });

      await expect(service.softDelete('contract-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when a CREATING contract already has signatures', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DRAFT',
        workflowStatus: 'CREATING',
        signatures: [{ signerType: 'CUSTOMER', signerName: 'สมชาย' }],
      });

      await expect(service.softDelete('contract-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows delete of a REJECTED contract that has signatures — cascade soft-deletes them', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DRAFT',
        workflowStatus: 'REJECTED',
        signatures: [
          { id: 'sig-1', signerType: 'CUSTOMER', signerName: 'สมชาย' },
          { id: 'sig-2', signerType: 'STAFF', signerName: 'พนง.' },
        ],
        productId: 'product-1',
      });
      prisma.$transaction.mockImplementation(async (opsOrFn: unknown) => {
        if (typeof opsOrFn === 'function') return (opsOrFn as (tx: unknown) => Promise<unknown>)(prisma);
        return Promise.all(opsOrFn as Promise<unknown>[]);
      });

      const result = await service.softDelete('contract-1', 'user-1');

      expect(result.message).toContain('ลายเซ็น 2');
      expect(prisma.signature.updateMany).toHaveBeenCalledWith({
        where: { contractId: 'contract-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CONTRACT_DELETE',
            entity: 'contract',
            entityId: 'contract-1',
            newValue: { cascadedSignatures: 2 },
          }),
        }),
      );
    });

    it('deletes a REJECTED contract without signatures — no signature cascade, no cascade message', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DRAFT',
        workflowStatus: 'REJECTED',
        signatures: [],
      });
      prisma.$transaction.mockImplementation(async (opsOrFn: unknown) => {
        if (typeof opsOrFn === 'function') return (opsOrFn as (tx: unknown) => Promise<unknown>)(prisma);
        return Promise.all(opsOrFn as Promise<unknown>[]);
      });

      const result = await service.softDelete('contract-1', 'user-1');

      expect(result.message).not.toContain('ลายเซ็น');
      expect(prisma.signature.updateMany).not.toHaveBeenCalled();
    });

    it('cascade-nulls CreditCheck.contractId so an approved check can be reused on a new contract', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DRAFT',
        workflowStatus: 'REJECTED',
        signatures: [],
      });
      prisma.$transaction.mockImplementation(async (opsOrFn: unknown) => {
        if (typeof opsOrFn === 'function') return (opsOrFn as (tx: unknown) => Promise<unknown>)(prisma);
        return Promise.all(opsOrFn as Promise<unknown>[]);
      });

      await service.softDelete('contract-1', 'user-1');

      expect(prisma.creditCheck.updateMany).toHaveBeenCalledWith({
        where: { contractId: 'contract-1' },
        data: { contractId: null },
      });
    });

    it('cascade soft-deletes KycVerification records tied to the deleted contract', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DRAFT',
        workflowStatus: 'REJECTED',
        signatures: [],
      });
      prisma.$transaction.mockImplementation(async (opsOrFn: unknown) => {
        if (typeof opsOrFn === 'function') return (opsOrFn as (tx: unknown) => Promise<unknown>)(prisma);
        return Promise.all(opsOrFn as Promise<unknown>[]);
      });

      await service.softDelete('contract-1', 'user-1');

      expect(prisma.kycVerification.updateMany).toHaveBeenCalledWith({
        where: { contractId: 'contract-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('soft-deletes the contract and releases the product back to IN_STOCK', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DRAFT',
        workflowStatus: 'CREATING',
        signatures: [],
        productId: 'product-1',
      });

      // $transaction receives an array of promises (not a callback) for this path
      prisma.$transaction.mockImplementation(
        async (opsOrFn: unknown) => {
          if (typeof opsOrFn === 'function') return (opsOrFn as (tx: unknown) => Promise<unknown>)(prisma);
          return Promise.all(opsOrFn as Promise<unknown>[]);
        },
      );

      const result = await service.softDelete('contract-1', 'user-1');

      expect(result).toEqual({ message: expect.stringContaining('soft delete') });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T5-C2 — softDelete immutability guard against drifted terminal statuses
  // ─────────────────────────────────────────────────────────────────────────────

  describe('T5-C2 — softDelete terminal-status immutability', () => {
    const txAsArray = async (opsOrFn: unknown) => {
      if (typeof opsOrFn === 'function') return (opsOrFn as (tx: unknown) => Promise<unknown>)(prisma);
      return Promise.all(opsOrFn as Promise<unknown>[]);
    };

    it('DRAFT contract can still be soft-deleted (happy path)', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DRAFT',
        workflowStatus: 'CREATING',
        signatures: [],
      });
      prisma.$transaction.mockImplementation(txAsArray);

      const result = await service.softDelete('contract-1', 'user-1');
      expect(result).toEqual({ message: expect.stringContaining('soft delete') });
    });

    it('ACTIVE contract is rejected with an immutability error (not the old generic error)', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'ACTIVE',
        workflowStatus: 'APPROVED',
        signatures: [],
      });

      await expect(service.softDelete('contract-1', 'user-1')).rejects.toThrow(
        /สถานะ ACTIVE/,
      );
    });

    it('CLOSED_BAD_DEBT contract is rejected even though workflow might still look CREATING', async () => {
      // Edge case: status drifted to CLOSED_BAD_DEBT while workflow never
      // updated — the explicit terminal-status guard catches this.
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'CLOSED_BAD_DEBT',
        workflowStatus: 'CREATING',
        signatures: [],
      });

      await expect(service.softDelete('contract-1', 'user-1')).rejects.toThrow(
        /CLOSED_BAD_DEBT/,
      );
    });

    it('DEFAULT contract is rejected with an immutability error', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'DEFAULT',
        workflowStatus: 'APPROVED',
        signatures: [],
      });

      await expect(service.softDelete('contract-1', 'user-1')).rejects.toThrow(
        /สถานะ DEFAULT/,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T5-C4 — financial fields locked once any payment row exists (incl. PENDING)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('T5-C4 — update financials blocked when any payment rows exist', () => {
    it('no payments yet → financial edit is allowed', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        salespersonId: 'user-1',
        workflowStatus: 'CREATING',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'SALES' });

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            payment: {
              // 1st call: existingPaymentCount, 2nd call: paidOrPartialCount, 3rd: overdueCount
              count: jest.fn().mockResolvedValue(0),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              createMany: jest.fn().mockResolvedValue({ count: 12 }),
            },
            contract: { update: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );
      prisma.contract.findUnique
        .mockResolvedValueOnce({ ...mockContract, salespersonId: 'user-1', workflowStatus: 'CREATING' })
        .mockResolvedValueOnce(mockContract);

      await expect(
        service.update('contract-1', { sellingPrice: 21000, downPayment: 3500, totalMonths: 12 }, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('one PENDING payment exists → changing sellingPrice is rejected', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        salespersonId: 'user-1',
        workflowStatus: 'CREATING',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'SALES' });

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            payment: {
              // existingPaymentCount: 1, paidOrPartialCount: 0
              count: jest.fn()
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0),
              updateMany: jest.fn(),
              createMany: jest.fn(),
            },
            contract: { update: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );

      // sellingPrice=19000 → 15% min = 2850, existing downPayment=3000 satisfies the floor.
      // This isolates the failure to the T5-C4 financial-change guard rather than
      // the minDownPaymentPct validation.
      await expect(
        service.update('contract-1', { sellingPrice: 19000 }, 'user-1'),
      ).rejects.toThrow(/ไม่สามารถแก้ไขเงื่อนไขทางการเงินได้/);
    });

    it('PENDING payment exists but only notes change → allowed', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        salespersonId: 'user-1',
        workflowStatus: 'CREATING',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'SALES' });

      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const txPrisma = {
            ...prisma,
            payment: {
              // existingPaymentCount: 1, paidOrPartialCount: 0 — no schedule recreation since existingPaymentCount>0
              count: jest.fn()
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0),
              updateMany: jest.fn(),
              createMany: jest.fn(),
            },
            contract: { update: jest.fn().mockResolvedValue({}) },
          };
          return fn(txPrisma);
        },
      );
      prisma.contract.findUnique
        .mockResolvedValueOnce({ ...mockContract, salespersonId: 'user-1', workflowStatus: 'CREATING' })
        .mockResolvedValueOnce(mockContract);

      await expect(
        service.update('contract-1', { notes: 'อัปเดตหมายเหตุ' }, 'user-1'),
      ).resolves.toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T4-C1 — salesperson reassignment guard
  // ─────────────────────────────────────────────────────────────────────────────

  describe('T4-C1 — updateSalesperson', () => {
    beforeEach(() => {
      prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
      prisma.$transaction.mockImplementation(
        async (fnOrArr: unknown) => {
          if (typeof fnOrArr === 'function') return (fnOrArr as (tx: unknown) => Promise<unknown>)(prisma);
          return Promise.all(fnOrArr as Promise<unknown>[]);
        },
      );
      // user.findUnique is used both for the actor role check (update path) and
      // new-salesperson lookup — return a generic active user by default.
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-new',
        role: 'SALES',
        deletedAt: null,
      });
    });

    it('DRAFT contract → SALES user can reassign (no lock, still audit-logged)', async () => {
      prisma.contract.findUnique
        .mockResolvedValueOnce({
          ...mockContract,
          status: 'DRAFT',
          workflowStatus: 'CREATING',
          salespersonId: 'user-old',
          signatures: [],
        })
        // second call: findOne() after update
        .mockResolvedValueOnce({ ...mockContract, salespersonId: 'user-new' });

      const result = await service.updateSalesperson('contract-1', 'user-new', {
        id: 'manager-1',
        role: 'BRANCH_MANAGER',
      });

      expect(result).toBeDefined();
      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { salespersonId: 'user-new' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'UPDATE_SALESPERSON',
            entity: 'contract',
            entityId: 'contract-1',
          }),
        }),
      );
    });

    it('APPROVED contract + non-OWNER actor → ForbiddenException', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce({
        ...mockContract,
        status: 'ACTIVE',
        workflowStatus: 'APPROVED',
        salespersonId: 'user-old',
        signatures: [],
      });

      await expect(
        service.updateSalesperson('contract-1', 'user-new', {
          id: 'manager-1',
          role: 'BRANCH_MANAGER',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.contract.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('APPROVED contract + OWNER actor → allowed and audit entry records override', async () => {
      prisma.contract.findUnique
        .mockResolvedValueOnce({
          ...mockContract,
          status: 'ACTIVE',
          workflowStatus: 'APPROVED',
          salespersonId: 'user-old',
          signatures: [{ id: 'sig-1' }],
          contractNumber: 'BC-2026-001',
        })
        .mockResolvedValueOnce({ ...mockContract, salespersonId: 'user-new' });

      const result = await service.updateSalesperson('contract-1', 'user-new', {
        id: 'owner-1',
        role: 'OWNER',
      });

      expect(result).toBeDefined();
      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { salespersonId: 'user-new' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'owner-1',
            action: 'UPDATE_SALESPERSON',
            newValue: expect.objectContaining({
              overrideReason: 'OWNER_OVERRIDE_AFTER_LOCK',
            }),
          }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // P4-SP4: Contract Cancellation
  // ─────────────────────────────────────────────────────────────────────────────

  describe('requestCancellation', () => {
    it('creates a PENDING cancellation row for an ACTIVE contract', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'ACTIVE',
        deletedAt: null,
      });
      prisma.contractCancellation = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'cancel-1',
          contractId: 'contract-1',
          status: 'PENDING',
          reason: 'ลูกค้าขอยกเลิก',
          refundAmount: 500,
          requestedBy: { id: 'user-1', name: 'พนักงาน 1' },
          contract: { id: 'contract-1', contractNumber: 'BC-2026-001', status: 'ACTIVE' },
        }),
      };

      const result = await service.requestCancellation(
        'contract-1',
        'user-1',
        'ลูกค้าขอยกเลิก',
        500,
      );

      expect(result.status).toBe('PENDING');
      expect(prisma.contractCancellation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'contract-1',
            requestedById: 'user-1',
            reason: 'ลูกค้าขอยกเลิก',
            status: 'PENDING',
          }),
        }),
      );
    });

    it('throws ConflictException when a PENDING cancellation already exists', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'ACTIVE',
        deletedAt: null,
      });
      prisma.contractCancellation = {
        findFirst: jest.fn().mockResolvedValue({ id: 'cancel-existing', status: 'PENDING' }),
        create: jest.fn(),
      };

      await expect(
        service.requestCancellation('contract-1', 'user-1', 'เหตุผล', 0),
      ).rejects.toThrow(ConflictException);
      expect(prisma.contractCancellation.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when contract is already CANCELED', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'CANCELED',
        deletedAt: null,
      });
      prisma.contractCancellation = {
        findFirst: jest.fn(),
        create: jest.fn(),
      };

      await expect(
        service.requestCancellation('contract-1', 'user-1', 'เหตุผล', 0),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveCancellation', () => {
    it('posts JE + updates cancellation to APPROVED + updates contract to CANCELED', async () => {
      const mockCancellationTemplate = {
        execute: jest.fn().mockResolvedValue({
          entryNumber: 'JE-202601-00010',
          refundEntryNumber: undefined,
        }),
      };

      // Re-create service with template injected
      const moduleWithTemplate = await Test.createTestingModule({
        providers: [
          ContractsService,
          { provide: PrismaService, useValue: prisma },
          { provide: 'ContractCancellationTemplate', useValue: mockCancellationTemplate },
        ],
      }).compile();
      const svcWithTemplate = moduleWithTemplate.get<ContractsService>(ContractsService);
      // Inject template via the Optional private property
      (svcWithTemplate as any).cancellationTemplate = mockCancellationTemplate;

      const mockCancellation = {
        id: 'cancel-1',
        contractId: 'contract-1',
        status: 'PENDING',
        refundAmount: { toString: () => '0' },
        deletedAt: null,
        contract: { ...mockContract, status: 'ACTIVE' },
      };

      prisma.contractCancellation = {
        findUnique: jest.fn().mockResolvedValue(mockCancellation),
        update: jest.fn().mockResolvedValue({ ...mockCancellation, status: 'APPROVED' }),
      };

      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'je-reversal-1' }),
      };

      prisma.$transaction = jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        return fn({
          ...prisma,
          contractCancellation: prisma.contractCancellation,
          contract: prisma.contract,
          journalEntry: prisma.journalEntry,
          auditLog: prisma.auditLog,
        });
      });

      const result = await svcWithTemplate.approveCancellation('cancel-1', 'approver-1');

      expect(result.status).toBe('APPROVED');
      expect(mockCancellationTemplate.execute).toHaveBeenCalled();
      expect(prisma.contractCancellation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cancel-1' },
          data: expect.objectContaining({ status: 'APPROVED', approvedById: 'approver-1' }),
        }),
      );
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contract-1' },
          data: expect.objectContaining({ status: 'CANCELED' }),
        }),
      );
    });
  });

  describe('rejectCancellation', () => {
    it('updates cancellation to REJECTED without posting any JE', async () => {
      const mockCancellationTemplate = {
        execute: jest.fn(),
      };

      prisma.contractCancellation = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cancel-1',
          status: 'PENDING',
          deletedAt: null,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'cancel-1',
          contractId: 'contract-1',
          status: 'REJECTED',
          contract: { id: 'contract-1', contractNumber: 'BC-2026-001' },
          requestedBy: { id: 'user-1', name: 'พนักงาน 1' },
          approvedBy: { id: 'approver-1', name: 'ผู้อนุมัติ' },
        }),
      };

      const result = await service.rejectCancellation('cancel-1', 'approver-1', 'ไม่อนุมัติ');

      expect(result.status).toBe('REJECTED');
      expect(mockCancellationTemplate.execute).not.toHaveBeenCalled();
      expect(prisma.contractCancellation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });
  });
});

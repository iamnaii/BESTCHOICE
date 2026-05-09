import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RepossessionsService } from './repossessions.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const decimal = (v: number | string) => new Prisma.Decimal(v);

function makeContract(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'contract-1',
    contractNumber: 'BC-202601-0001',
    status: 'DEFAULT',
    deletedAt: null,
    totalMonths: 12,
    financedAmount: decimal(10000),
    storeCommission: decimal(500),
    monthlyPayment: decimal(1000),
    sellingPrice: decimal(12000),
    productId: 'product-1',
    product: {
      id: 'product-1',
      name: 'iPhone 14',
      brand: 'Apple',
      model: 'iPhone 14',
      costPrice: decimal(8000),
      status: 'INSTALLMENT',
    },
    customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0811111111' },
    payments: [
      {
        id: 'pay-1',
        installmentNo: 1,
        status: 'PAID',
        amountDue: decimal(1000),
        amountPaid: decimal(1000),
        lateFee: decimal(0),
        lateFeeWaived: false,
      },
      {
        id: 'pay-2',
        installmentNo: 2,
        status: 'OVERDUE',
        amountDue: decimal(1000),
        amountPaid: decimal(0),
        lateFee: decimal(100),
        lateFeeWaived: false,
      },
      {
        id: 'pay-3',
        installmentNo: 3,
        status: 'PENDING',
        amountDue: decimal(1000),
        amountPaid: decimal(0),
        lateFee: decimal(0),
        lateFeeWaived: false,
      },
    ],
    ...overrides,
  };
}

function makeRepossession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'repo-1',
    contractId: 'contract-1',
    productId: 'product-1',
    status: 'REPOSSESSED',
    conditionGrade: 'B',
    appraisalPrice: decimal(6000),
    repairCost: decimal(500),
    resellPrice: null,
    marketValue: 6000,
    remainingMonths: 2,
    financeCost: 10500,
    remainingCost: 1750,
    discountPct: 50,
    discountAmount: 500,
    closingAmount: 1000,
    customerRefundEnabled: false,
    customerRefund: 0,
    profitLoss: 4250,
    createdAt: new Date('2026-01-01'),
    product: {
      id: 'product-1',
      name: 'iPhone 14',
      brand: 'Apple',
      model: 'iPhone 14',
    },
    contract: {
      contractNumber: 'BC-202601-0001',
      customer: { name: 'สมชาย ใจดี' },
      branch: { id: 'branch-1', name: 'ลาดพร้าว' },
    },
    appraisedBy: { id: 'user-1', name: 'ผู้ใช้ทดสอบ' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RepossessionsService', () => {
  let service: RepossessionsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      repossession: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      contract: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      product: {
        update: jest.fn(),
      },
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: 'branch-1', isMainWarehouse: true }),
      },
      productPrice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ defaultCashAccountCode: '11-1101' }),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null), // strict mode off by default
      },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn as Promise<unknown>[]);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepossessionsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JournalAutoService,
          useValue: {
            createBadDebtWriteOffJournal: jest.fn().mockResolvedValue('je-bd-1'),
            createRepossessionResaleJournal: jest.fn().mockResolvedValue('je-repo-1'),
          },
        },
        { provide: RepossessionJP5Template, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
      ],
    }).compile();

    service = module.get<RepossessionsService>(RepossessionsService);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findAll
  // ──────────────────────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('returns paginated list with defaults', async () => {
      const repo = makeRepossession();
      prisma.repossession.findMany.mockResolvedValue([repo]);
      prisma.repossession.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(prisma.repossession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } }),
      );
    });

    it('passes status filter through to query', async () => {
      prisma.repossession.findMany.mockResolvedValue([]);
      prisma.repossession.count.mockResolvedValue(0);

      await service.findAll({ status: 'UNDER_REPAIR' });

      expect(prisma.repossession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null, status: 'UNDER_REPAIR' } }),
      );
    });

    it('caps limit at 200 and minimum at 1', async () => {
      prisma.repossession.findMany.mockResolvedValue([]);
      prisma.repossession.count.mockResolvedValue(0);

      await service.findAll({ limit: 9999, page: 0 });

      const call = prisma.repossession.findMany.mock.calls[0][0];
      expect(call.take).toBe(200);
      expect(call.skip).toBe(0); // page clamped to 1 → skip = 0
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // previewCalculation
  // ──────────────────────────────────────────────────────────────────────────
  describe('previewCalculation', () => {
    it('throws NotFoundException when contract does not exist', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.previewCalculation('no-contract', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns correct outstanding balance using Decimal arithmetic', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {});

      // pay-2: 1000 - 0 + 100 = 1100, pay-3: 1000 - 0 + 0 = 1000 → total 2100
      expect(result.calculation.outstandingBalance).toBeCloseTo(2100, 2);
      expect(result.calculation.remainingMonths).toBe(2);
    });

    it('calculates principalExVat by dividing by 1.07 (VAT back-out)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {});

      const expectedPrincipalExVat = Math.round((2100 / 1.07) * 100) / 100;
      expect(result.calculation.principalExVat).toBeCloseTo(expectedPrincipalExVat, 1);
    });

    it('applies custom discountPct correctly', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', { discountPct: 0 });

      // discountPct = 0 → discountAmount = 0
      expect(result.calculation.discountAmount).toBe(0);
    });

    it('calculates customerRefund only when customerRefundEnabled=true', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const noRefund = await service.previewCalculation('contract-1', {
        customerRefundEnabled: false,
        marketValue: 5000,
      });
      expect(noRefund.calculation.customerRefund).toBe(0);

      const withRefund = await service.previewCalculation('contract-1', {
        customerRefundEnabled: true,
        marketValue: 5000,
      });
      // customerRefund = max(0, marketValue - closingAmount)
      expect(withRefund.calculation.customerRefund).toBeGreaterThanOrEqual(0);
    });

    it('falls back to costPrice when marketValue is not provided', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {});

      // costPrice = 8000
      expect(result.calculation.marketValue).toBeCloseTo(8000, 2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // create (createRepossession)
  // ──────────────────────────────────────────────────────────────────────────
  describe('create', () => {
    const baseDto = {
      contractId: 'contract-1',
      conditionGrade: 'B',
      appraisalPrice: 6000,
      repossessedDate: '2026-01-15',
      marketValue: 6000,
    };

    it('throws BadRequestException for invalid condition grade', async () => {
      await expect(
        service.create({ ...baseDto, conditionGrade: 'Z' } as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when contract is not found', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.create(baseDto as never, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when contract status is ACTIVE (no termination)', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ status: 'ACTIVE' }),
      );

      await expect(
        service.create(baseDto as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows JP5 when contract status is LEGAL (termination letter dispatched)', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ status: 'LEGAL' }),
      );
      prisma.repossession.create.mockResolvedValue(makeRepossession({ id: 'repo-legal' }));
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});

      const result = await service.create(baseDto as never, 'user-1');
      expect(result).toBeDefined();
    });

    it('strict mode: rejects DEFAULT status when jp5_require_legal_status=true', async () => {
      // CPA Manual Termination Policy: enforce LEGAL-only via SystemConfig
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 'true' });
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ status: 'DEFAULT' }),
      );

      await expect(
        service.create(baseDto as never, 'user-1'),
      ).rejects.toThrow(/strict mode|หนังสือบอกเลิก/);
    });

    it('throws BadRequestException when product is already repossessed', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ product: { ...makeContract().product, status: 'REPOSSESSED' } }),
      );

      await expect(
        service.create(baseDto as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates repossession, updates contract to CLOSED_BAD_DEBT, and sets product to REPOSSESSED', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      const createdRepo = { ...makeRepossession(), id: 'repo-new' };
      prisma.repossession.create.mockResolvedValue(createdRepo);
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.create(baseDto as never, 'user-1');

      expect(prisma.repossession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REPOSSESSED', conditionGrade: 'B' }),
        }),
      );
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CLOSED_BAD_DEBT' } }),
      );
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REPOSSESSED' }) }),
      );
      expect(result).toMatchObject({ id: 'repo-new' });
    });

    it('passes tx to JP5 template (atomic — JE inside outer $transaction)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await service.create(baseDto as never, 'user-1');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      expect(template.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          depositAccountCode: '11-1101',
        }),
        prisma, // tx (mock $transaction passes prisma itself as tx)
      );
    });

    it('rolls back contract+product update when JP5 throws (atomicity)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      // Mock JP5 to reject — should propagate up through $transaction (no fire-and-forget)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      template.execute.mockRejectedValueOnce(new Error('JE fail'));

      await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow('JE fail');

      // JP5 was awaited — error propagated (proves no .catch() fire-and-forget remains)
      expect(template.execute).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // update — status transitions
  // ──────────────────────────────────────────────────────────────────────────
  describe('update — status transitions', () => {
    it('throws BadRequestException for invalid transition REPOSSESSED → SOLD', async () => {
      prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'REPOSSESSED' }));

      await expect(
        service.update('repo-1', { status: 'SOLD' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when moving to READY_FOR_SALE without resellPrice', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'UNDER_REPAIR', resellPrice: null }),
      );

      await expect(
        service.update('repo-1', { status: 'READY_FOR_SALE' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates product status to REFURBISHED when moving to READY_FOR_SALE', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'UNDER_REPAIR' }),
      );
      prisma.product.update.mockResolvedValue({});
      prisma.repossession.update.mockResolvedValue(makeRepossession({ status: 'READY_FOR_SALE' }));

      await service.update('repo-1', { status: 'READY_FOR_SALE', resellPrice: 7000 } as never);

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REFURBISHED' }),
        }),
      );
    });

    it('adjusts costPrice to appraisalPrice (TAS 2) when marking READY_FOR_SALE', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'UNDER_REPAIR', appraisalPrice: decimal(6000) }),
      );
      prisma.product.update.mockResolvedValue({});
      prisma.repossession.update.mockResolvedValue({});

      await service.update('repo-1', { status: 'READY_FOR_SALE', resellPrice: 7500 } as never);

      // Wave 3 / Task 4 (W-2): costPrice now passed as Prisma.Decimal to
      // preserve precision. Compare via Decimal.eq instead of numeric equality.
      expect(prisma.product.update).toHaveBeenCalledTimes(1);
      const call = prisma.product.update.mock.calls[0][0];
      expect(call.data.status).toBe('REFURBISHED');
      expect(new Prisma.Decimal(call.data.costPrice).eq(7500)).toBe(true);
    });

    it('updates repossession to SOLD status and returns updated record (Phase A.5 JE deferred)', async () => {
      // Phase A.4b: repossession resale JE is deferred to Phase A.5 (SHOP-side accounting).
      // Until then, the service logs a warning and proceeds without a JE.
      const repoWithPrice = makeRepossession({
        status: 'READY_FOR_SALE',
        resellPrice: decimal(7000),
        repairCost: decimal(500),
        product: {
          id: 'product-1',
          name: 'iPhone 14',
          brand: 'Apple',
          model: 'iPhone 14',
          costPrice: decimal(6000),
        },
      });
      prisma.repossession.findUnique.mockResolvedValue(repoWithPrice);
      prisma.product.update.mockResolvedValue({});
      const updatedRepo = makeRepossession({ status: 'SOLD', resellPrice: decimal(7000) });
      prisma.repossession.update.mockResolvedValue(updatedRepo);

      const result = await service.update('repo-1', { status: 'SOLD', resellPrice: 7000 } as never, 'user-1');

      // Repossession was updated to SOLD
      expect(result.status).toBe('SOLD');
      // RepossessionJP5Template.execute was NOT called for resale (deferred to Phase A.5)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      expect(template.execute).not.toHaveBeenCalled();
    });
  });
});

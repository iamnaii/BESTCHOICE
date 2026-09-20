import * as creditApproval from '../credit-check/services/credit-approval';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { SalesService } from './sales.service';
import { INSTALLMENT_VIA_CONTRACT_MSG } from './services/sale-creation.service';
import { SalesController } from './sales.controller';
import { VoidSaleDto } from './dto/void-sale.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { InterCompanyService } from '../inter-company/inter-company.service';
import { ShopCashSaleTemplate } from '../journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ShopExternalFinanceSaleTemplate } from '../journal/cpa-templates/shop-external-finance-sale.template';
import { SaleWarrantyNotifierService } from './services/sale-warranty-notifier.service';

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
 *  - create (INSTALLMENT): rejected — in-house installment goes through the contract page only
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
  resolveBranchVat: jest.fn().mockResolvedValue({ vatPct: 0.07, source: 'BRANCH_COMPANY' }),
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
    branchId: 'branch-1', wasPreviouslyDamaged: false, id: 'product-1',
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
    jest.spyOn(creditApproval, 'claimCreditApproval').mockResolvedValue({ id: 'approved-cap' } as never);
    prisma = {
      saleCostSnapshot: { aggregate: jest.fn().mockResolvedValue({ _sum: { mainProductCost: new Prisma.Decimal(18000) } }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      sale: {
        findMany: jest.fn().mockResolvedValue([mockSale]),
        findUnique: jest.fn().mockResolvedValue(mockSale),
        findFirst: jest.fn().mockResolvedValue(mockSale),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { netAmount: new Prisma.Decimal(25000), discount: new Prisma.Decimal(0) } }),
        groupBy: jest.fn().mockImplementation(async ({ by }) => by[0] === 'productId' ? [] : [
          { saleType: 'CASH', _count: 1, _sum: { netAmount: new Prisma.Decimal(25000) } },
        ]),
        create: jest.fn().mockResolvedValue(mockSale),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'customer-1', name: 'Test customer', phone: '0891234567', addressCurrent: null }),
        // รั้วกันข้ามฝั่ง (spec 2026-09-05 §5.1 — SaleCreationService.assertSameTestSideForSale)
        // อ่านลูกค้าก่อน dispatch ไป writer — ค่าเริ่มต้นเป็นลูกค้าจริง (ที่อยู่ null / เบอร์ปกติ)
        // ให้รั้วเงียบ: เทสในไฟล์นี้เป็นเรื่องขายจริง ไม่ได้ทดสอบตัวรั้ว
        findFirst: jest.fn().mockResolvedValue({
          id: 'customer-1',
          name: 'สมหญิง ใจดี',
          phone: '0891234567',
          addressCurrent: null,
        }),
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
        findMany: jest.fn().mockResolvedValue([]),
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
      // B5: preemptReservationsInTx runs inside the same tx right after the
      // product status flip in every create*Sale path — every txPrisma stub
      // in this file needs this, whether via `...prisma` spread or built
      // standalone (see the two EXTERNAL_FINANCE tests below that don't spread).
      // closeRepossessionOnSale (2026-09-05) — POS closes a REPOSSESSED/READY_FOR_SALE row itself
      repossession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      externalFinanceCompany: {
        upsert: jest.fn().mockResolvedValue({ id: 'mock-co' }),
      },
      // สมุดเงินหน้าร้าน (shop_tenders, 2026-09-20): ShopTenderRecorder ถูกสร้าง inline ใน SaleWriterService และเขียนผ่าน
      // tx ตัวเดียวกันในทุกเส้นทาง create*Sale. recorder ใช้ ShopAccountResolver ตัวจริงของมันเอง (ไม่ใช่ mock ที่ inject
      // ให้ service) ⇒ tender เงินสดอ่าน branch.shopCashAccountCode จาก tx; journalEntry.findFirst ใช้เฉพาะบิลจ่ายผสม.
      shopTender: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      branch: { findUnique: jest.fn().mockResolvedValue({ shopCashAccountCode: 'S11-1102' }) },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'user-1', name: 'พนักงาน 1' }]),
      },
      systemConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        // resolveSaleShopWarranty อ่านคีย์ warranty.shopWarrantyDays ตอนสร้างใบขาย
        // ไม่มีแถว = ไม่ override ⇒ ใช้ค่าตามชนิดสินค้า
        findUnique: jest.fn().mockResolvedValue(null),
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
        {
          provide: ShopCashSaleTemplate,
          useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1', journalEntryId: 'je-1' }) },
        },
        {
          provide: ShopAccountResolver,
          useValue: { resolveInflowCashAccount: jest.fn().mockResolvedValue('S11-1102'), resolveProductAccounts: jest.fn().mockReturnValue({ inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' }) },
        },
        {
          // C1 — ข้ามเองถ้าผังยังไม่มี S11-3101/S51-1106 (รอคำวินิจฉัยผู้สอบ)
          provide: ShopExternalFinanceSaleTemplate,
          useValue: { execute: jest.fn().mockResolvedValue(null) },
        },
        {
          // แจ้งประกันทาง LINE เป็น fire-and-forget หลัง commit — ไฟล์นี้ไม่ตรวจการส่ง
          provide: SaleWarrantyNotifierService,
          useValue: { notify: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findAll
  // ─────────────────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('always includes deletedAt: null to exclude soft-deleted sales', async () => {
      await service.findAll({}, { id: 'owner-1', role: 'OWNER' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
    });

    it('includeVoided=true → ไม่ใส่ตัวกรอง deletedAt (เห็นใบที่ยกเลิกด้วย)', async () => {
      await service.findAll({ includeVoided: true }, { id: 'owner-1', role: 'OWNER' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeUndefined();
    });

    it('รายการดึง voidedBy มาด้วย ให้หน้าจอแสดงชื่อผู้ยกเลิกบนแถวที่เปิด includeVoided', async () => {
      await service.findAll({ includeVoided: true }, { id: 'owner-1', role: 'OWNER' });
      const include = prisma.sale.findMany.mock.calls[0][0].include;
      expect(include.voidedBy).toEqual({ select: { id: true, name: true } });
    });

    it('filters by saleType when provided', async () => {
      await service.findAll({ saleType: 'CASH' }, { id: 'owner-1', role: 'OWNER' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.saleType).toBe('CASH');
    });

    it('filters by branchId when provided', async () => {
      await service.findAll({ branchId: 'branch-99' }, { id: 'owner-1', role: 'OWNER' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.branchId).toBe('branch-99');
    });

    it('builds OR search across saleNumber, customer name, product name, and finance fields', async () => {
      await service.findAll({ search: 'SL000' }, { id: 'owner-1', role: 'OWNER' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeDefined();
      expect(where.OR.length).toBeGreaterThanOrEqual(2);
    });

    it('applies date range filter when startDate and endDate are provided', async () => {
      await service.findAll({ startDate: '2026-01-01', endDate: '2026-01-31' }, { id: 'owner-1', role: 'OWNER' });
      const where = prisma.sale.findMany.mock.calls[0][0].where;
      const createdAt = where.createdAt as Record<string, Date>;
      expect(createdAt.gte).toBeInstanceOf(Date);
      expect(createdAt.lt).toBeInstanceOf(Date);
    });

    it('defaults to page 1 and limit 50', async () => {
      await service.findAll({}, { id: 'owner-1', role: 'OWNER' });
      const call = prisma.sale.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(50);
    });

    it('strips costPrice from product data for non-OWNER roles', async () => {
      const result = await service.findAll({}, { id: 'sales-1', role: 'SALES', branchId: 'branch-1' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstProduct = (result.data[0] as any).product;
      expect(firstProduct).not.toHaveProperty('costPrice');
    });

    it('keeps costPrice in product data for OWNER role', async () => {
      const result = await service.findAll({}, { id: 'owner-1', role: 'OWNER' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstProduct = (result.data[0] as any).product;
      expect(firstProduct).toHaveProperty('costPrice');
    });

    it('calculates totalProfit only for OWNER role (non-OWNER gets 0)', async () => {
      const ownerResult = await service.findAll({}, { id: 'owner-1', role: 'OWNER' });
      const salesResult = await service.findAll({}, { id: 'sales-1', role: 'SALES', branchId: 'branch-1' });

      // OWNER: profit = netAmount - costPrice per sale
      expect(typeof ownerResult.summary.totalProfit).toBe('number');
      // SALES: no profit exposure
      expect(salesResult.summary.totalProfit).toBe(0);
    });

    it('includes a summary with cash/installment/finance counts', async () => {
      prisma.sale.groupBy.mockImplementation(async ({ by }: { by: string[] }) => by[0] === 'productId' ? [] : [
        { saleType: 'CASH', _count: 3, _sum: { netAmount: new Prisma.Decimal(75000) } },
        { saleType: 'INSTALLMENT', _count: 2, _sum: { netAmount: new Prisma.Decimal(40000) } },
        { saleType: 'EXTERNAL_FINANCE', _count: 1, _sum: { netAmount: new Prisma.Decimal(20000) } },
      ]);

      const result = await service.findAll({}, { id: 'owner-1', role: 'OWNER' });

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
      const result = await service.findOne('sale-1', { id: 'owner-1', role: 'OWNER' });
      expect(result.id).toBe('sale-1');
    });

    it('throws NotFoundException when sale does not exist', async () => {
      prisma.sale.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', { id: 'owner-1', role: 'OWNER' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('เปิดดูใบที่ยกเลิกแล้วได้ (ไม่ throw) พร้อมข้อมูลการยกเลิก', async () => {
      const voidedAt = new Date();
      prisma.sale.findFirst.mockResolvedValue({
        ...mockSale,
        deletedAt: voidedAt,
        voidReason: 'คีย์ผิดรุ่นเครื่อง ลูกค้าไม่ได้ซื้อ',
        voidedBy: { id: 'u-owner', name: 'เจ้าของร้าน' },
      });
      const result = await service.findOne('sale-1', { id: 'owner-1', role: 'OWNER' });
      expect(result.deletedAt).toEqual(voidedAt);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).voidReason).toBe('คีย์ผิดรุ่นเครื่อง ลูกค้าไม่ได้ซื้อ');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).voidedBy).toEqual({ id: 'u-owner', name: 'เจ้าของร้าน' });
    });

    it('ดึง voidedBy (ชื่อผู้ยกเลิก) มากับใบขายเสมอ ให้หน้าจอแสดงได้', async () => {
      await service.findOne('sale-1', { id: 'owner-1', role: 'OWNER' });
      const include = prisma.sale.findFirst.mock.calls[0][0].include;
      expect(include.voidedBy).toEqual({ select: { id: true, name: true } });
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
        service.create({ ...cashDto, paymentMethod: undefined }, 'user-1', 'SALES', 'branch-1'),
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
      await expect(service.create(cashDto, 'user-1', 'SALES', 'branch-1')).rejects.toBeInstanceOf(BadRequestException);
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
              findMany: jest.fn().mockResolvedValue([{ id: 'product-1', category: 'PHONE_NEW', costPrice: mockProduct.costPrice }]),
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

      await service.create(cashDto, 'user-1', 'SALES', 'branch-1');
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
              findMany: jest.fn().mockResolvedValue([{ id: 'product-1', category: 'PHONE_NEW', costPrice: mockProduct.costPrice }]),
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

      await service.create(cashDto, 'user-1', 'SALES', 'branch-1');
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
              findMany: jest.fn().mockResolvedValue([{ id: 'product-1', category: 'PHONE_NEW', costPrice: mockProduct.costPrice }]),
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

      await service.create(cashDto, 'user-1', 'SALES', 'branch-1');
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
        service.create({ ...cashDto, bundleProductIds: ['bundle-1'] }, 'user-1', 'SALES', 'branch-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // create — INSTALLMENT sale (rejected — contract page only)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('create — INSTALLMENT', () => {
    // ขายผ่อนในเครือทำผ่านหน้าสัญญาทางเดียว (2026-09-20) — เส้นทางเก่าที่สร้างสัญญา+ตารางงวด+ลูกหนี้ในเครือจาก POST /sales ถูกถอด
    it('rejects with a pointer to the contract page and never opens a transaction', async () => {
      await expect(
        service.create({ saleType: 'INSTALLMENT', customerId: 'customer-1', productId: 'product-1', branchId: 'branch-1',
          sellingPrice: 20000, downPayment: 3500, totalMonths: 12, paymentMethod: 'CASH' } as any, 'user-1'),
      ).rejects.toThrow(INSTALLMENT_VIA_CONTRACT_MSG);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(interCompanyService.createFromSaleInTx).not.toHaveBeenCalled();
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
      // โอน/QR บังคับเลขอ้างอิงจากสลิป (กติกาช่องรับเงิน 2026-09-20) — caller แบบเดิมส่งผ่าน downPaymentReference
      downPaymentReference: 'TEST-REF-0001',
      financeCompany: 'GFIN',
      financeAmount: 20000,
      downPayment: 5000,
    };

    it('throws BadRequestException when financeCompany is not provided', async () => {
      await expect(
        service.create({ ...extFinanceDto, financeCompany: undefined }, 'user-1', 'SALES', 'branch-1'),
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
            // closeRepossessionOnSale (2026-09-05) — POS closes a REPOSSESSED/READY_FOR_SALE row itself
            repossession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            productReservation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          };
          return fn(txPrisma);
        },
      );

      await service.create(extFinanceDto, 'user-1', 'SALES', 'branch-1');
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
            // closeRepossessionOnSale (2026-09-05) — POS closes a REPOSSESSED/READY_FOR_SALE row itself
            repossession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            productReservation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          };
          return fn(txPrisma);
        },
      );

      await service.create(extFinanceDto, 'user-1', 'SALES', 'branch-1');

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

      await expect(service.create(extFinanceDto, 'user-1', 'SALES', 'branch-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getSalespersons
  // ─────────────────────────────────────────────────────────────────────────────

  describe('getSalespersons', () => {
    it('returns all active salespersons for OWNER role (no branch filter)', async () => {
      await service.getSalespersons({ id: 'user-1', role: 'OWNER' });
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.branchId).toBeUndefined();
    });

    it('filters salespersons by branchId for BRANCH_MANAGER role', async () => {
      await service.getSalespersons({ id: 'user-1', role: 'BRANCH_MANAGER', branchId: 'branch-1' });
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.branchId).toBe('branch-1');
    });

    it('always filters for active (non-deleted) users', async () => {
      await service.getSalespersons({ id: 'user-1', role: 'SALES' });
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(true);
      expect(where.deletedAt).toBeNull();
    });
  });

  // T5-C1 — discount cost-floor + role cap guard. Checks only the early
  // assertion path — we don't expect the full sale to succeed in this block.
  describe('create — discount cost-floor + role cap (T5-C1)', () => {
    const cashDto = (overrides: Record<string, unknown> = {}) => ({
      saleType: 'CASH' as const,
      productId: 'p1',
      sellingPrice: 20000,
      discount: 0,
      paymentMethod: 'CASH',
      ...overrides,
    });

    beforeEach(() => {
      prisma.product.findUnique = jest.fn().mockResolvedValue({ costPrice: 18000 });
    });

    it('rejects a SALES discount above 5%', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.create(cashDto({ discount: 1200 }) as any, 'sp-1', 'SALES', 'branch-1'),
      ).rejects.toThrow(/เกินขีดจำกัด 5%/);
    });

    it('rejects a BRANCH_MANAGER discount above 15%', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.create(cashDto({ discount: 3100 }) as any, 'bm-1', 'BRANCH_MANAGER', 'branch-1'),
      ).rejects.toThrow(/เกินขีดจำกัด 15%/);
    });

    it('rejects a 12% BRANCH_MANAGER discount without a second approver', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.create(cashDto({ discount: 2400 }) as any, 'bm-1', 'BRANCH_MANAGER', 'branch-1'),
      ).rejects.toThrow(/ต้องมีผู้อนุมัติเพิ่มเติม/);
    });

    it('rejects when the net price drops below the cost floor for non-OWNER', async () => {
      // cost 18000, BM floor = 18000 × (1 - 0.15) = 15300. 20000 - 5000 = 15000.
      // Discount 5000 / 20000 = 25% > BM 15% cap → role cap error fires first.
      await expect(
        service.create(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cashDto({ discount: 5000, secondApproverId: 'fm-1' }) as any,
          'bm-1',
          'BRANCH_MANAGER', 'branch-1',
        ),
      ).rejects.toThrow(/เกินขีดจำกัด 15%/);
    });

    it('allows OWNER unlimited discount (strategic / dead stock clearance)', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.create(cashDto({ discount: 10000 }) as any, 'owner-1', 'OWNER', 'branch-1'),
      ).rejects.not.toThrow(/เกินขีดจำกัด|ต่ำกว่าขั้นต่ำ|ต้องมีผู้อนุมัติ/);
    });
  });

  describe('create — wasPreviouslyDamaged guard (T5-C8)', () => {
    const cashDto = (overrides: Record<string, unknown> = {}) => ({
      saleType: 'CASH' as const,
      productId: 'p1',
      sellingPrice: 20000,
      discount: 0,
      paymentMethod: 'CASH',
      ...overrides,
    });

    beforeEach(() => {
      // Product has damage history flag set
      prisma.product.findUnique = jest.fn().mockResolvedValue({
        costPrice: 18000,
        wasPreviouslyDamaged: true,
        deletedAt: null,
      });
    });

    it('rejects sale when acknowledgement flag missing', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.create(cashDto() as any, 'owner-1', 'OWNER', 'branch-1'),
      ).rejects.toThrow(/previouslyDamagedAcknowledged/);
    });

    it('rejects SALES even with acknowledgement', async () => {
      await expect(
        service.create(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cashDto({ previouslyDamagedAcknowledged: true }) as any,
          'sp-1',
          'SALES', 'branch-1',
        ),
      ).rejects.toThrow(/OWNER \/ FINANCE_MANAGER/);
    });

    it('rejects BRANCH_MANAGER even with acknowledgement', async () => {
      await expect(
        service.create(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cashDto({ previouslyDamagedAcknowledged: true }) as any,
          'bm-1',
          'BRANCH_MANAGER', 'branch-1',
        ),
      ).rejects.toThrow(/OWNER \/ FINANCE_MANAGER/);
    });

    it('OWNER + acknowledgement passes the T5-C8 guard (fails later on unrelated stock check, not on T5-C8)', async () => {
      await expect(
        service.create(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cashDto({ previouslyDamagedAcknowledged: true }) as any,
          'owner-1',
          'OWNER', 'branch-1',
        ),
      ).rejects.not.toThrow(/previouslyDamagedAcknowledged|OWNER \/ FINANCE_MANAGER/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SalesController — POST /sales/:id/void (Task 4)
// ─────────────────────────────────────────────────────────────────────────────

describe('SalesController — POST /sales/:id/void', () => {
  it('ส่ง saleId + userId ของผู้กด + เหตุผล เข้า SaleVoidService', async () => {
    const voidService = {
      voidSale: jest.fn().mockResolvedValue({
        saleNumber: 'SL000001',
        restoredProductIds: ['product-1'],
        reversalEntryNumbers: ['JE-1'],
      }),
    };
    const controller = new SalesController({} as never, voidService as never);

    const user = { id: 'u1', role: 'OWNER', branchId: 'branch-1' };
    await controller.voidSale('s1', { reason: 'คีย์ผิดรุ่นเครื่อง' }, user);

    // ส่ง user ทั้งก้อน (id + role + branchId) — service ใช้ role/branchId ทำ branch scope
    expect(voidService.voidSale).toHaveBeenCalledWith('s1', user, 'คีย์ผิดรุ่นเครื่อง');
  });

  it('จำกัดสิทธิ์ OWNER + BRANCH_MANAGER เท่านั้น (@Roles metadata)', () => {
    const roles = Reflect.getMetadata('roles', SalesController.prototype.voidSale);
    expect(roles).toEqual(['OWNER', 'BRANCH_MANAGER']);
  });
});

describe('VoidSaleDto — เหตุผลการยกเลิก', () => {
  it('ปฏิเสธเหตุผลสั้นกว่า 10 ตัวอักษร ด้วยข้อความไทย', async () => {
    const dto = new VoidSaleDto();
    dto.reason = 'สั้นไป';
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร',
    );
  });

  it('รับเหตุผลยาว ≥10 ตัวอักษร', async () => {
    const dto = new VoidSaleDto();
    dto.reason = 'คีย์ผิดรุ่นเครื่อง ลูกค้าไม่ได้ซื้อ';
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

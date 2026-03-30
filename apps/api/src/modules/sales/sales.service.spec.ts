/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('../../utils/installment.util', () => ({
  calculateInstallment: jest.fn().mockReturnValue({
    principal: 8000,
    interestTotal: 3840,
    storeCommission: 0,
    vatAmount: 0,
    financedAmount: 11840,
    monthlyPayment: 1974,
  }),
  generatePaymentSchedule: jest.fn().mockReturnValue([
    { contractId: 'contract-1', installmentNo: 1, dueDate: new Date(), amountDue: 1974, status: 'PENDING' },
  ]),
}));

jest.mock('../../utils/config.util', () => ({
  loadInstallmentConfig: jest.fn().mockResolvedValue({
    interestRate: 0.08,
    minDownPaymentPct: 0.15,
    minInstallmentMonths: 6,
    maxInstallmentMonths: 12,
    storeCommissionPct: 0,
    vatPct: 0,
  }),
  resolveInstallmentParams: jest.fn().mockReturnValue({
    interestRate: 0.08,
    minDownPaymentPct: 0.15,
    minInstallmentMonths: 6,
    maxInstallmentMonths: 12,
    storeCommissionPct: 0,
    vatPct: 0,
  }),
}));

jest.mock('../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('BCP2603-00001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
}));

describe('SalesService', () => {
  let service: SalesService;
  let prisma: any;

  const mockProduct = {
    id: 'product-1',
    name: 'iPhone 16',
    brand: 'Apple',
    model: 'iPhone 16',
    status: 'IN_STOCK',
    category: 'SMARTPHONE',
    costPrice: 25000,
    imeiSerial: '490154203237518',
  };

  const mockSale = {
    id: 'sale-1',
    saleNumber: 'SL000001',
    saleType: 'CASH',
    customerId: 'customer-1',
    productId: 'product-1',
    branchId: 'branch-1',
    salespersonId: 'user-1',
    sellingPrice: 35000,
    discount: 0,
    netAmount: 35000,
    paymentMethod: 'CASH',
    amountReceived: 35000,
  };

  const txMock: any = {};

  beforeEach(async () => {
    const mockPrisma = {
      sale: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(mockSale),
        aggregate: jest.fn().mockResolvedValue({ _sum: { netAmount: 0, discount: 0 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(mockProduct),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      contract: {
        create: jest.fn().mockResolvedValue({ id: 'contract-1', contractNumber: 'BCP2603-00001' }),
      },
      payment: {
        createMany: jest.fn().mockResolvedValue({ count: 6 }),
      },
      interestConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb) => {
        // Build txMock to mirror mockPrisma for transaction callback
        Object.assign(txMock, {
          sale: mockPrisma.sale,
          product: mockPrisma.product,
          contract: mockPrisma.contract,
          payment: mockPrisma.payment,
        });
        return cb(txMock);
      }),
      $queryRaw: jest.fn().mockResolvedValue([{ total_profit: '10000' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  // ─── create (dispatch) ────────────────────────────────
  describe('create', () => {
    it('should throw for invalid saleType', async () => {
      await expect(
        service.create({ saleType: 'INVALID' } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── createCashSale ───────────────────────────────────
  describe('createCashSale (via create)', () => {
    const cashDto = {
      saleType: 'CASH' as const,
      customerId: 'customer-1',
      productId: 'product-1',
      branchId: 'branch-1',
      sellingPrice: 35000,
      paymentMethod: 'CASH',
    };

    it('should create a cash sale successfully', async () => {
      const result = await service.create(cashDto as any, 'user-1');

      expect(result.saleNumber).toBe('SL000001');
      expect(result.saleType).toBe('CASH');
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'SOLD_CASH' },
        }),
      );
    });

    it('should throw if paymentMethod is missing', async () => {
      await expect(
        service.create({ ...cashDto, paymentMethod: undefined } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if product is not IN_STOCK', async () => {
      prisma.product.findUnique.mockResolvedValue({ ...mockProduct, status: 'SOLD_CASH' });

      await expect(
        service.create(cashDto as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if product not found', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.create(cashDto as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should mark bundle products as SOLD_CASH', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'bundle-1', status: 'IN_STOCK', name: 'Case' },
      ]);

      await service.create(
        { ...cashDto, bundleProductIds: ['bundle-1'] } as any,
        'user-1',
      );

      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['bundle-1'] } },
          data: { status: 'SOLD_CASH' },
        }),
      );
    });

    it('should throw if bundle product is not IN_STOCK', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'bundle-1', status: 'SOLD_CASH', name: 'Case' },
      ]);

      await expect(
        service.create(
          { ...cashDto, bundleProductIds: ['bundle-1'] } as any,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should calculate netAmount as sellingPrice minus discount', async () => {
      prisma.sale.create.mockImplementation(({ data }: any) => Promise.resolve(data));

      await service.create({ ...cashDto, discount: 2000 } as any, 'user-1');

      expect(prisma.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            netAmount: 33000,
            discount: 2000,
          }),
        }),
      );
    });
  });

  // ─── createInstallmentSale ────────────────────────────
  describe('createInstallmentSale (via create)', () => {
    const installmentDto = {
      saleType: 'INSTALLMENT' as const,
      customerId: 'customer-1',
      productId: 'product-1',
      branchId: 'branch-1',
      sellingPrice: 10000,
      downPayment: 2000,
      totalMonths: 6,
    };

    it('should create installment sale with contract and schedule', async () => {
      prisma.sale.create.mockResolvedValue({ ...mockSale, saleType: 'INSTALLMENT' });

      const result = await service.create(installmentDto as any, 'user-1');

      expect(prisma.contract.create).toHaveBeenCalled();
      expect(prisma.payment.createMany).toHaveBeenCalled();
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'RESERVED' } }),
      );
    });

    it('should throw if downPayment is missing', async () => {
      await expect(
        service.create({ ...installmentDto, downPayment: undefined } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if totalMonths is missing', async () => {
      await expect(
        service.create({ ...installmentDto, totalMonths: undefined } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if downPayment is below minimum percentage', async () => {
      // minDownPaymentPct is 0.15, so min is 10000 * 0.15 = 1500
      await expect(
        service.create({ ...installmentDto, downPayment: 500 } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if totalMonths exceeds max', async () => {
      await expect(
        service.create({ ...installmentDto, totalMonths: 24 } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if totalMonths is below min', async () => {
      await expect(
        service.create({ ...installmentDto, totalMonths: 2 } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should default planType to STORE_DIRECT', async () => {
      prisma.sale.create.mockResolvedValue({ ...mockSale, saleType: 'INSTALLMENT' });

      await service.create(installmentDto as any, 'user-1');

      expect(prisma.contract.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planType: 'STORE_DIRECT' }),
        }),
      );
    });
  });

  // ─── createExternalFinanceSale ────────────────────────
  describe('createExternalFinanceSale (via create)', () => {
    const extFinDto = {
      saleType: 'EXTERNAL_FINANCE' as const,
      customerId: 'customer-1',
      productId: 'product-1',
      branchId: 'branch-1',
      sellingPrice: 40000,
      financeCompany: 'Aeon',
      paymentMethod: 'BANK_TRANSFER',
    };

    it('should create external finance sale', async () => {
      prisma.sale.create.mockResolvedValue({ ...mockSale, saleType: 'EXTERNAL_FINANCE' });

      const result = await service.create(extFinDto as any, 'user-1');

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'SOLD_INSTALLMENT' },
        }),
      );
    });

    it('should throw if financeCompany is missing', async () => {
      await expect(
        service.create({ ...extFinDto, financeCompany: undefined } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should calculate financeAmount from net minus downPayment', async () => {
      prisma.sale.create.mockImplementation(({ data }: any) => Promise.resolve(data));

      await service.create({ ...extFinDto, downPayment: 5000 } as any, 'user-1');

      expect(prisma.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            financeAmount: 35000, // 40000 - 5000
          }),
        }),
      );
    });
  });

  // ─── findOne ──────────────────────────────────────────
  describe('findOne', () => {
    it('should return sale with relations', async () => {
      prisma.sale.findUnique.mockResolvedValue({
        ...mockSale,
        customer: { name: 'Test' },
        product: mockProduct,
      });

      const result = await service.findOne('sale-1');

      expect(result.id).toBe('sale-1');
    });

    it('should throw NotFoundException if sale not found', async () => {
      prisma.sale.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findAll ──────────────────────────────────────────
  describe('findAll', () => {
    it('should return paginated sales with summary', async () => {
      prisma.sale.findMany
        .mockResolvedValueOnce([{ ...mockSale, product: { ...mockProduct } }])
        .mockResolvedValueOnce([{ id: 'sale-1' }]); // for profit query
      prisma.sale.count.mockResolvedValue(1);
      prisma.sale.aggregate.mockResolvedValue({
        _sum: { netAmount: 35000, discount: 0 },
      });
      prisma.sale.groupBy.mockResolvedValue([
        { saleType: 'CASH', _count: 1, _sum: { netAmount: 35000 } },
      ]);

      const result = await service.findAll({ userRole: 'OWNER' });

      expect(result.total).toBe(1);
      expect(result.summary.cashCount).toBe(1);
      expect(result.summary.cashAmount).toBe(35000);
    });

    it('should strip costPrice for non-OWNER roles', async () => {
      prisma.sale.findMany.mockResolvedValue([
        { ...mockSale, product: { ...mockProduct } },
      ]);
      prisma.sale.count.mockResolvedValue(1);
      prisma.sale.aggregate.mockResolvedValue({ _sum: { netAmount: 35000, discount: 0 } });
      prisma.sale.groupBy.mockResolvedValue([]);

      const result = await service.findAll({ userRole: 'SALES' });

      expect((result.data[0] as any).product.costPrice).toBeUndefined();
    });

    it('should include totalProfit for OWNER', async () => {
      prisma.sale.findMany
        .mockResolvedValueOnce([{ ...mockSale, product: { ...mockProduct } }])
        .mockResolvedValueOnce([{ id: 'sale-1' }]);
      prisma.sale.count.mockResolvedValue(1);
      prisma.sale.aggregate.mockResolvedValue({ _sum: { netAmount: 35000, discount: 0 } });
      prisma.sale.groupBy.mockResolvedValue([]);

      const result = await service.findAll({ userRole: 'OWNER' });

      expect(result.summary.totalProfit).toBe(10000);
    });
  });

  // ─── getSalespersons ──────────────────────────────────
  describe('getSalespersons', () => {
    it('should return active users for OWNER', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u-1', name: 'Staff' }]);

      const result = await service.getSalespersons({ role: 'OWNER' });

      expect(result).toHaveLength(1);
    });

    it('should filter by branch for BRANCH_MANAGER', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.getSalespersons({ role: 'BRANCH_MANAGER', branchId: 'branch-1' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'branch-1' }),
        }),
      );
    });
  });

  // ─── getDailySummary ──────────────────────────────────
  describe('getDailySummary', () => {
    it('should return daily summary with revenue', async () => {
      prisma.sale.findMany.mockResolvedValue([
        { ...mockSale, saleType: 'CASH', netAmount: 35000 },
        { ...mockSale, id: 'sale-2', saleType: 'INSTALLMENT', netAmount: 15000 },
      ]);

      const result = await service.getDailySummary('2026-03-15');

      expect(result.totalSales).toBe(2);
      expect(result.cashSales).toBe(1);
      expect(result.installmentSales).toBe(1);
      expect(result.totalRevenue).toBe(50000);
    });

    it('should handle empty day', async () => {
      prisma.sale.findMany.mockResolvedValue([]);

      const result = await service.getDailySummary('2026-03-15');

      expect(result.totalSales).toBe(0);
      expect(result.totalRevenue).toBe(0);
    });

    it('should filter by branchId when provided', async () => {
      prisma.sale.findMany.mockResolvedValue([]);

      await service.getDailySummary('2026-03-15', 'branch-1');

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'branch-1' }),
        }),
      );
    });
  });
});

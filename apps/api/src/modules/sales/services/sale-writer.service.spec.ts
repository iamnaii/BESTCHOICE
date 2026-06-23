import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { SaleWriterService } from './sale-writer.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { InterCompanyService } from '../../inter-company/inter-company.service';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

// ─── module-level mocks ───────────────────────────────────────────────────────

jest.mock('../../../utils/sequence.util', () => ({
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
  generateContractNumber: jest.fn().mockResolvedValue('BC-2026-TEST-001'),
}));

jest.mock('../../../utils/commission.util', () => ({
  computeCommissionAmount: jest.fn().mockReturnValue(250),
}));

// ─── test suite ──────────────────────────────────────────────────────────────

describe('SaleWriterService — createCashSale JE wiring', () => {
  let service: SaleWriterService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shopCashSaleTemplate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shopAccountResolver: any;

  const mockSale = { id: 'sale-1', saleNumber: 'SL000001' };

  const mockCommissionRule = {
    id: 'cr-1',
    isActive: true,
    deletedAt: null,
    rate: new Decimal(0.025),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    // ── per-test tx mock (mimics what $transaction exposes inside callback) ──
    tx = {
      sale: {
        create: jest.fn().mockResolvedValue(mockSale),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          status: 'IN_STOCK',
          deletedAt: null,
          wasPreviouslyDamaged: false,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      commissionRule: {
        findFirst: jest.fn().mockResolvedValue(mockCommissionRule),
      },
      salesCommission: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    prisma = {
      $transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
    };

    shopCashSaleTemplate = {
      execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1', journalEntryId: 'je-1' }),
    };

    shopAccountResolver = {
      resolveInflowCashAccount: jest.fn().mockResolvedValue('S11-1102'),
      resolveProductAccounts: jest.fn().mockReturnValue({
        inventoryAccountCode: 'S11-2001',
        cogsAccountCode: 'S50-1101',
        revenueAccountCode: 'S41-1101',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleWriterService,
        { provide: PrismaService, useValue: prisma },
        { provide: InterCompanyService, useValue: { createFromSaleInTx: jest.fn() } },
        { provide: ShopCashSaleTemplate, useValue: shopCashSaleTemplate },
        { provide: ShopAccountResolver, useValue: shopAccountResolver },
      ],
    }).compile();

    service = module.get<SaleWriterService>(SaleWriterService);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // (a) single CASH product → 1 JE
  // ─────────────────────────────────────────────────────────────────────────────

  it('(a) single CASH product → posts one ShopCashSale JE with correct key, codes, revenue, cost, and tx', async () => {
    tx.product.findMany.mockResolvedValue([
      { id: 'p1', category: 'PHONE_NEW', costPrice: new Decimal(7000) },
    ]);
    shopAccountResolver.resolveInflowCashAccount.mockResolvedValue('S11-1102');
    shopAccountResolver.resolveProductAccounts.mockReturnValue({
      inventoryAccountCode: 'S11-2001',
      cogsAccountCode: 'S50-1101',
      revenueAccountCode: 'S41-1101',
    });

    await service.createCashSale(
      {
        productId: 'p1',
        branchId: 'br-1',
        customerId: 'c1',
        sellingPrice: 10000,
        bundleProductIds: [],
        paymentMethod: 'CASH',
      } as any,
      'sp-1',
      10000,
      0,
    );

    expect(shopCashSaleTemplate.execute).toHaveBeenCalledTimes(1);

    const [input, passedTx] = shopCashSaleTemplate.execute.mock.calls[0];
    expect(input).toMatchObject({
      idempotencyKey: 'shop-cash-sale:sale-1:p1',
      saleId: 'sale-1',
      cashAccountCode: 'S11-1102',
      revenueAccountCode: 'S41-1101',
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
    });
    expect(input.revenueAmount.toString()).toBe('10000');
    expect(input.inventoryCost.toString()).toBe('7000');
    // tx must be passed (atomicity)
    expect(passedTx).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // (b) 2-product bundle → 2 JEs, per-product keys, revenues sum to net
  // ─────────────────────────────────────────────────────────────────────────────

  it('(b) 2-product bundle (PHONE_NEW + ACCESSORY) → 2 JEs, per-product keys, revenues sum to net', async () => {
    // markBundleProductsSold calls findMany({where:{id:{in:['p2']},deletedAt:null},...}) — return 1 item
    // JE allocation block calls findMany({where:{id:{in:['p1','p2']}},...}) — return both with full data
    tx.product.findMany
      .mockResolvedValueOnce([
        { id: 'p2', status: 'IN_STOCK', name: 'Case' },
      ])
      .mockResolvedValueOnce([
        { id: 'p1', category: 'PHONE_NEW', costPrice: new Decimal(6000), status: 'IN_STOCK', name: 'Phone' },
        { id: 'p2', category: 'ACCESSORY', costPrice: new Decimal(400), status: 'IN_STOCK', name: 'Case' },
      ]);

    // resolveProductAccounts returns different codes based on category
    shopAccountResolver.resolveProductAccounts.mockImplementation(
      (category: string) => {
        if (category === 'PHONE_NEW') {
          return { inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' };
        }
        // ACCESSORY
        return { inventoryAccountCode: 'S11-2003', cogsAccountCode: 'S50-1103', revenueAccountCode: 'S41-1103' };
      },
    );

    await service.createCashSale(
      {
        productId: 'p1',
        branchId: 'br-1',
        customerId: 'c1',
        sellingPrice: 1000,
        bundleProductIds: ['p2'],
        paymentMethod: 'CASH',
      } as any,
      'sp-1',
      1000,
      0,
    );

    expect(shopCashSaleTemplate.execute).toHaveBeenCalledTimes(2);

    const calls = shopCashSaleTemplate.execute.mock.calls;

    // First call = p1 (main product, preserving order)
    const [input1] = calls[0];
    expect(input1.idempotencyKey).toBe('shop-cash-sale:sale-1:p1');
    expect(input1.revenueAccountCode).toBe('S41-1101');
    expect(input1.cogsAccountCode).toBe('S50-1101');
    expect(input1.inventoryAccountCode).toBe('S11-2001');

    // Second call = p2 (bundle product)
    const [input2] = calls[1];
    expect(input2.idempotencyKey).toBe('shop-cash-sale:sale-1:p2');
    expect(input2.revenueAccountCode).toBe('S41-1103');
    expect(input2.cogsAccountCode).toBe('S50-1103');
    expect(input2.inventoryAccountCode).toBe('S11-2003');

    // Revenues sum to net (1000)
    const rev1 = new Decimal(input1.revenueAmount.toString());
    const rev2 = new Decimal(input2.revenueAmount.toString());
    expect(rev1.plus(rev2).toNumber()).toBe(1000);

    // Both allocations have > 0 revenue (totalCost = 6400, both cost > 0)
    expect(rev1.gt(0)).toBe(true);
    expect(rev2.gt(0)).toBe(true);

    // p1 cost allocation: 6000/6400 × 1000 = 937.50
    expect(input1.inventoryCost.toString()).toBe('6000');
    // p2 cost allocation: 400
    expect(input2.inventoryCost.toString()).toBe('400');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // (c) BANK_TRANSFER → cash account = S11-1201
  // ─────────────────────────────────────────────────────────────────────────────

  it('(c) BANK_TRANSFER payment → cashAccountCode = S11-1201', async () => {
    tx.product.findMany.mockResolvedValue([
      { id: 'p1', category: 'PHONE_NEW', costPrice: new Decimal(5000) },
    ]);
    // resolveInflowCashAccount returns SHOP_RECEIVING_BANK for non-CASH methods
    shopAccountResolver.resolveInflowCashAccount.mockResolvedValue('S11-1201');

    await service.createCashSale(
      {
        productId: 'p1',
        branchId: 'br-1',
        customerId: 'c1',
        sellingPrice: 8000,
        bundleProductIds: [],
        paymentMethod: 'BANK_TRANSFER',
      } as any,
      'sp-1',
      8000,
      0,
    );

    expect(shopCashSaleTemplate.execute).toHaveBeenCalledTimes(1);
    const [input] = shopCashSaleTemplate.execute.mock.calls[0];
    expect(input.cashAccountCode).toBe('S11-1201');

    // Confirm that resolveInflowCashAccount was called with branchId + BANK_TRANSFER
    expect(shopAccountResolver.resolveInflowCashAccount).toHaveBeenCalledWith(
      'br-1',
      'BANK_TRANSFER',
      tx,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // (d) Zero-cost product in bundle → skipped by wiring (continue on !alloc.revenue.gt(0))
  // ─────────────────────────────────────────────────────────────────────────────

  it('(d) 2-product bundle with second product costPrice=0 → skips zero-cost product, 1 JE posted', async () => {
    // markBundleProductsSold calls findMany({where:{id:{in:['p2']},deletedAt:null},...}) — return 1 item
    // JE allocation block calls findMany({where:{id:{in:['p1','p2']}},...}) — return both with full data
    tx.product.findMany
      .mockResolvedValueOnce([
        { id: 'p2', status: 'IN_STOCK', name: 'Case' },
      ])
      .mockResolvedValueOnce([
        { id: 'p1', category: 'PHONE_NEW', costPrice: new Decimal(7000), status: 'IN_STOCK', name: 'Phone' },
        { id: 'p2', category: 'ACCESSORY', costPrice: new Decimal(0), status: 'IN_STOCK', name: 'Case' },
      ]);

    shopAccountResolver.resolveProductAccounts.mockImplementation(
      (category: string) => {
        if (category === 'PHONE_NEW') {
          return { inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' };
        }
        // ACCESSORY
        return { inventoryAccountCode: 'S11-2003', cogsAccountCode: 'S50-1103', revenueAccountCode: 'S41-1103' };
      },
    );

    await service.createCashSale(
      {
        productId: 'p1',
        branchId: 'br-1',
        customerId: 'c1',
        sellingPrice: 10000,
        bundleProductIds: ['p2'],
        paymentMethod: 'CASH',
      } as any,
      'sp-1',
      10000,
      0,
    );

    // Main product only (p2 skipped because allocation.revenue = 0)
    expect(shopCashSaleTemplate.execute).toHaveBeenCalledTimes(1);

    const [input] = shopCashSaleTemplate.execute.mock.calls[0];
    expect(input.idempotencyKey).toBe('shop-cash-sale:sale-1:p1');
    expect(input.revenueAmount.toString()).toBe('10000');
  });
});

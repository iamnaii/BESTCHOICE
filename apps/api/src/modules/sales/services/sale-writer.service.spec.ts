import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma = {
      $transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
      // createInstallmentSale reads these BEFORE opening its $transaction.
      // interestConfig = null → params fall back to config.util DEFAULTS
      // (minDownPaymentPct 0.15 / months 6-12) และ getRateForMonths ไม่ถูกเรียก
      // → เลขเงินคุมได้จาก DTO อย่างเดียว ไม่มี I/O ซ่อน
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      interestConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findUnique: jest.fn().mockResolvedValue(null) },
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

  // ───────────────────────────────────────────────────────────────────────────
  // (e) B5 — preempt hold ของเว็บใน tx เดียวกับที่เครื่องออกจาก IN_STOCK
  // ───────────────────────────────────────────────────────────────────────────

  it('(e) createCashSale: ตัด hold ของเครื่องหลัก + ของแถม ภายใน tx เดียวกัน', async () => {
    tx.product.findMany
      .mockResolvedValueOnce([{ id: 'p2', status: 'IN_STOCK', name: 'Case' }])
      .mockResolvedValueOnce([
        { id: 'p1', category: 'PHONE_NEW', costPrice: new Decimal(7000) },
        { id: 'p2', category: 'ACCESSORY', costPrice: new Decimal(500) },
      ]);
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.createCashSale(
      {
        productId: 'p1', branchId: 'br-1', customerId: 'c1',
        sellingPrice: 10000, bundleProductIds: ['p2'], paymentMethod: 'CASH',
      } as any,
      'sp-1', 10000, 0,
    );

    // ของแถมถูกตัดก่อน (ใน markBundleProductsSold) แล้วเครื่องหลักตามหลัง product.update
    const calls = tx.productReservation.updateMany.mock.calls;
    expect(calls[0][0].where.productId).toEqual({ in: ['p2'] });
    expect(calls[1][0].where.productId).toEqual({ in: ['p1'] });
    calls.forEach((c: any) => {
      expect(c[0].where.status).toBe('ACTIVE');
      expect(c[0].where.expiresAt.gt).toBeInstanceOf(Date);
      expect(c[0].data).toEqual({ status: 'PREEMPTED' });
    });
    // red line perf: ห้ามมี range read บนตารางนี้ — tx นี้เป็น Serializable และไม่มี retry
    expect(tx.productReservation.findMany).toBeUndefined();
  });

  it('(f) createInstallmentSale: ตัด hold หลัง flip เครื่องเป็น RESERVED', async () => {
    // downPayment 3000 = 15% ของ 20000 พอดี = ค่า DEFAULTS.minDownPaymentPct
    // (config.util.ts:183) → ผ่านเงื่อนไข `downPayment < netAmount * pct` แบบเฉียดฉิว
    // ห้ามลดเลขนี้ ไม่งั้นจะโดน BadRequestException 'เงินดาวน์ขั้นต่ำ 15%' แทน
    tx.contract = { create: jest.fn().mockResolvedValue({ id: 'ct-1', salespersonId: 'sp-1' }) };
    tx.payment = { createMany: jest.fn().mockResolvedValue({ count: 12 }) };
    tx.financeReceivable = { create: jest.fn().mockResolvedValue({}) };
    tx.externalFinanceCompany = { upsert: jest.fn().mockResolvedValue({ id: 'ef-1' }) };
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.createInstallmentSale(
      {
        productId: 'p1', branchId: 'br-1', customerId: 'c1', sellingPrice: 20000,
        bundleProductIds: [], downPayment: 3000, totalMonths: 12, paymentMethod: 'CASH',
      } as any,
      'sp-1', 20000, 0,
    );

    const call = tx.productReservation.updateMany.mock.calls.at(-1)[0];
    expect(call.where.productId).toEqual({ in: ['p1'] });
    expect(call.where.status).toBe('ACTIVE');
    expect(call.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(call.data).toEqual({ status: 'PREEMPTED' });
  });

  it('(g) createExternalFinanceSale: ตัด hold หลัง flip เป็น SOLD_INSTALLMENT', async () => {
    tx.financeReceivable = { create: jest.fn().mockResolvedValue({}) };
    tx.externalFinanceCompany = { upsert: jest.fn().mockResolvedValue({ id: 'ef-1' }) };
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.createExternalFinanceSale(
      {
        productId: 'p1', branchId: 'br-1', customerId: 'c1', sellingPrice: 15000,
        bundleProductIds: [], financeCompany: 'GFIN', downPayment: 2000, paymentMethod: 'CASH',
      } as any,
      'sp-1', 15000, 0,
    );

    const call = tx.productReservation.updateMany.mock.calls.at(-1)[0];
    expect(call.where.productId).toEqual({ in: ['p1'] });
    expect(call.where.status).toBe('ACTIVE');
    expect(call.data).toEqual({ status: 'PREEMPTED' });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (h)-(m) B5 forward-flag — P2002/P2034 retry wrapper around $transaction.
  // Serializable tx + new productReservation writes raise write-write
  // conflict odds (P2034); separately, sequence.util.ts's unlocked
  // findFirst(desc)+parseInt+1 number generators give createInstallmentSale
  // (default isolation) a genuine P2002 race on Contract.contractNumber /
  // Sale.saleNumber. Neither should surface as a raw 500 at the cashier's
  // screen. Pattern mirrors contract-lifecycle.service.ts:255-259
  // (MAX_RETRIES=3, retry on Prisma-known P2002 OR P2034, everything else
  // propagates immediately — fix round 1: widened from P2034-only after
  // review found the P2002 exclusion's stated justification false).
  // ───────────────────────────────────────────────────────────────────────────

  describe('B5 forward-flag — P2002/P2034 retry wrapper', () => {
    const p2034 = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'x',
    });

    it('(h) createCashSale: first $transaction attempt rejects P2034 → retried → succeeds', async () => {
      tx.product.findMany.mockResolvedValue([
        { id: 'p1', category: 'PHONE_NEW', costPrice: new Decimal(7000) },
      ]);
      tx.productReservation.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction
        .mockImplementationOnce(async () => { throw p2034; })
        .mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      const result = await service.createCashSale(
        {
          productId: 'p1', branchId: 'br-1', customerId: 'c1',
          sellingPrice: 10000, bundleProductIds: [], paymentMethod: 'CASH',
        } as any,
        'sp-1', 10000, 0,
      );

      expect(result).toEqual(mockSale);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('(i) createInstallmentSale: first $transaction attempt rejects P2034 → retried → succeeds', async () => {
      tx.contract = { create: jest.fn().mockResolvedValue({ id: 'ct-1', salespersonId: 'sp-1' }) };
      tx.payment = { createMany: jest.fn().mockResolvedValue({ count: 12 }) };
      tx.financeReceivable = { create: jest.fn().mockResolvedValue({}) };
      tx.externalFinanceCompany = { upsert: jest.fn().mockResolvedValue({ id: 'ef-1' }) };
      tx.productReservation.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction
        .mockImplementationOnce(async () => { throw p2034; })
        .mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      const result = await service.createInstallmentSale(
        {
          productId: 'p1', branchId: 'br-1', customerId: 'c1', sellingPrice: 20000,
          bundleProductIds: [], downPayment: 3000, totalMonths: 12, paymentMethod: 'CASH',
        } as any,
        'sp-1', 20000, 0,
      );

      expect(result).toEqual(mockSale);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('(j) createExternalFinanceSale: first $transaction attempt rejects P2034 → retried → succeeds', async () => {
      tx.financeReceivable = { create: jest.fn().mockResolvedValue({}) };
      tx.externalFinanceCompany = { upsert: jest.fn().mockResolvedValue({ id: 'ef-1' }) };
      tx.productReservation.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction
        .mockImplementationOnce(async () => { throw p2034; })
        .mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      const result = await service.createExternalFinanceSale(
        {
          productId: 'p1', branchId: 'br-1', customerId: 'c1', sellingPrice: 15000,
          bundleProductIds: [], financeCompany: 'GFIN', downPayment: 2000, paymentMethod: 'CASH',
        } as any,
        'sp-1', 15000, 0,
      );

      expect(result).toEqual(mockSale);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('(k) createCashSale: non-retryable P2025 (not P2002/P2034) propagates on the first attempt', async () => {
      // P2025 = "Record to update not found" — a real Prisma-known code that is
      // neither P2002 nor P2034, so this still pins "unknown/non-retryable
      // errors are NOT retried" now that P2002 itself IS retryable (fix round 1).
      const p2025 = new Prisma.PrismaClientKnownRequestError('record not found', {
        code: 'P2025',
        clientVersion: 'x',
      });
      prisma.$transaction.mockImplementation(async () => { throw p2025; });

      await expect(
        service.createCashSale(
          {
            productId: 'p1', branchId: 'br-1', customerId: 'c1',
            sellingPrice: 10000, bundleProductIds: [], paymentMethod: 'CASH',
          } as any,
          'sp-1', 10000, 0,
        ),
      ).rejects.toBe(p2025);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('(l) createCashSale: P2034 exhausts all 3 attempts → propagates the P2034', async () => {
      prisma.$transaction.mockImplementation(async () => { throw p2034; });

      await expect(
        service.createCashSale(
          {
            productId: 'p1', branchId: 'br-1', customerId: 'c1',
            sellingPrice: 10000, bundleProductIds: [], paymentMethod: 'CASH',
          } as any,
          'sp-1', 10000, 0,
        ),
      ).rejects.toBe(p2034);
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('(m) createInstallmentSale: first attempt rejects P2002 (unlocked contractNumber race) → retried → succeeds', async () => {
      // Fix round 1: sequence.util.ts's generateContractNumber/generateSaleNumber
      // have no advisory lock (plain findFirst(desc)+parseInt+1) — two concurrent
      // installment sales (default isolation, no Serializable) can race to INSERT
      // the same Contract.contractNumber, producing a real P2002. This must retry
      // exactly like contract-lifecycle.service.ts's own P2002 branch for that field.
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on Contract.contractNumber',
        { code: 'P2002', clientVersion: 'x' },
      );
      tx.contract = { create: jest.fn().mockResolvedValue({ id: 'ct-1', salespersonId: 'sp-1' }) };
      tx.payment = { createMany: jest.fn().mockResolvedValue({ count: 12 }) };
      tx.financeReceivable = { create: jest.fn().mockResolvedValue({}) };
      tx.externalFinanceCompany = { upsert: jest.fn().mockResolvedValue({ id: 'ef-1' }) };
      tx.productReservation.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction
        .mockImplementationOnce(async () => { throw p2002; })
        .mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      const result = await service.createInstallmentSale(
        {
          productId: 'p1', branchId: 'br-1', customerId: 'c1', sellingPrice: 20000,
          bundleProductIds: [], downPayment: 3000, totalMonths: 12, paymentMethod: 'CASH',
        } as any,
        'sp-1', 20000, 0,
      );

      expect(result).toEqual(mockSale);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});

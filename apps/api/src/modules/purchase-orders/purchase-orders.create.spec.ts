import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Characterization (golden) spec for PurchaseOrdersService.create() money math.
 *
 * Pins the CURRENT behavior of:
 *  - totalAmount = Σ(quantity × unitPrice) as Prisma.Decimal
 *  - discount / discountAfterVat handling (discountAfterVat is forced to 0 when
 *    supplier.hasVat is false)
 *  - vatAmount = (subtotal − discount) × vatRate, rounded to 2dp ROUND_HALF_UP
 *    when supplier.hasVat; vatAmount = 0 when !hasVat
 *  - netAmount = subtotalAfterDiscount + vatAmount − discountAfterVat
 *  - line totals (per-item brand/model/quantity/unitPrice passthrough)
 *  - dueDate = orderDate + selected payment method's creditTermDays
 *
 * vatRate is resolved via loadVatRateDecimal(prisma) which falls back to the
 * Thailand-standard 0.07 when SystemConfig has no VAT_RATE / vat_pct / vat_rate
 * key. These tests leave SystemConfig empty so vatRate == 0.07.
 *
 * Mock style mirrors the sibling purchase-orders.service.spec.ts (plain object
 * prisma mock, $transaction invokes the callback with the same prisma mock).
 */
describe('PurchaseOrdersService.create() — VAT/net/discount math (characterization)', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // Captures the data passed to purchaseOrder.create() inside the tx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastCreateArg: any;

  /**
   * Build the prisma mock. `supplier` is the row returned by
   * prisma.supplier.findUnique (the `select`ed shape the service expects).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildPrisma(supplier: any) {
    lastCreateArg = undefined;
    return {
      supplier: {
        findUnique: jest.fn().mockResolvedValue(supplier),
      },
      systemConfig: {
        // No VAT config rows → loadVatRateDecimal falls back to 0.07.
        findMany: jest.fn().mockResolvedValue([]),
      },
      purchaseOrder: {
        // generatePONumber() calls count() inside the tx.
        count: jest.fn().mockResolvedValue(0),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: jest.fn().mockImplementation((arg: any) => {
          lastCreateArg = arg;
          return Promise.resolve({ id: 'po-created', ...arg.data });
        }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (fn as (tx: any) => unknown)(prisma);
        }
        return Promise.all(fn as Promise<unknown>[]);
      }),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function makeService(supplier: any) {
    prisma = buildPrisma(supplier);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<PurchaseOrdersService>(PurchaseOrdersService);
  }

  it('throws NotFoundException when supplier is missing', async () => {
    await makeService(null);
    await expect(
      service.create(
        {
          supplierId: 'nope',
          orderDate: '2026-06-01',
          items: [{ quantity: 1, unitPrice: 100 }],
        } as never,
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when supplier is soft-deleted', async () => {
    await makeService({ deletedAt: new Date('2026-01-01'), hasVat: true, paymentMethods: [] });
    await expect(
      service.create(
        {
          supplierId: 'sup-deleted',
          orderDate: '2026-06-01',
          items: [{ quantity: 1, unitPrice: 100 }],
        } as never,
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  describe('supplier.hasVat = true', () => {
    it('pins HALF_UP rounding on an x.xx5 VAT product (7.035 → 7.04)', async () => {
      // totalAmount = 1 × 100.50 = 100.50
      // subtotalAfterDiscount = 100.50 − 0 = 100.50
      // vatAmount = 100.50 × 0.07 = 7.035 → ROUND_HALF_UP → 7.04
      // netAmount = 100.50 + 7.04 − 0 = 107.54
      await makeService({ deletedAt: null, hasVat: true, paymentMethods: [] });

      await service.create(
        {
          supplierId: 'sup-1',
          orderDate: '2026-06-01',
          items: [{ brand: 'Apple', model: 'iPhone 16', quantity: 1, unitPrice: 100.5 }],
        } as never,
        'user-1',
      );

      const data = lastCreateArg.data;
      expect(data.totalAmount.toString()).toBe('100.5');
      expect(data.discount.toString()).toBe('0');
      expect(data.discountAfterVat.toString()).toBe('0');
      // Golden: half-satang rounds UP, not down.
      expect(data.vatAmount.toString()).toBe('7.04');
      expect(data.netAmount.toString()).toBe('107.54');

      // vatAmount must be a Prisma.Decimal, not a JS number/float.
      expect(data.vatAmount).toBeInstanceOf(Prisma.Decimal);
    });

    it('applies pre-VAT discount and post-VAT discount to net (133.00 VAT path)', async () => {
      // totalAmount = 2 × 1000 = 2000
      // subtotalAfterDiscount = 2000 − 100 = 1900
      // vatAmount = 1900 × 0.07 = 133.00
      // netAmount = 1900 + 133 − 33 = 2000.00
      await makeService({ deletedAt: null, hasVat: true, paymentMethods: [] });

      await service.create(
        {
          supplierId: 'sup-1',
          orderDate: '2026-06-01',
          discount: 100,
          discountAfterVat: 33,
          items: [{ brand: 'Apple', model: 'iPhone 16', quantity: 2, unitPrice: 1000 }],
        } as never,
        'user-1',
      );

      const data = lastCreateArg.data;
      expect(data.totalAmount.toString()).toBe('2000');
      expect(data.discount.toString()).toBe('100');
      expect(data.discountAfterVat.toString()).toBe('33');
      expect(data.vatAmount.toString()).toBe('133');
      expect(data.netAmount.toString()).toBe('2000');
    });

    it('pins line totals (per-item fields passthrough) for multiple items', async () => {
      // item1: 2 × 500 = 1000 ; item2: 3 × 250.25 = 750.75 ; total = 1750.75
      // vatAmount = 1750.75 × 0.07 = 122.5525 → ROUND_HALF_UP(2dp) → 122.55
      // netAmount = 1750.75 + 122.55 − 0 = 1873.30 (Decimal trims to 1873.3)
      await makeService({ deletedAt: null, hasVat: true, paymentMethods: [] });

      await service.create(
        {
          supplierId: 'sup-1',
          orderDate: '2026-06-01',
          items: [
            { brand: 'Samsung', model: 'A15', quantity: 2, unitPrice: 500 },
            { brand: 'Apple', model: 'Cable', quantity: 3, unitPrice: 250.25 },
          ],
        } as never,
        'user-1',
      );

      const data = lastCreateArg.data;
      expect(data.totalAmount.toString()).toBe('1750.75');
      expect(data.vatAmount.toString()).toBe('122.55');
      expect(data.netAmount.toString()).toBe('1873.3');

      // Line items are created nested with quantity/unitPrice/brand/model intact.
      const lines = data.items.create;
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ brand: 'Samsung', model: 'A15', quantity: 2, unitPrice: 500 });
      expect(lines[1]).toMatchObject({ brand: 'Apple', model: 'Cable', quantity: 3, unitPrice: 250.25 });
    });
  });

  describe('supplier.hasVat = false', () => {
    it('forces vatAmount = 0 and netAmount = subtotal − discount; ignores discountAfterVat', async () => {
      // totalAmount = 3 × 500 = 1500
      // discount = 50 → subtotalAfterDiscount = 1450
      // hasVat=false → vatAmount = 0, discountAfterVat coerced to 0 even though 999 passed
      // netAmount = 1450 + 0 − 0 = 1450
      await makeService({ deletedAt: null, hasVat: false, paymentMethods: [] });

      await service.create(
        {
          supplierId: 'sup-1',
          orderDate: '2026-06-01',
          discount: 50,
          discountAfterVat: 999, // must be ignored because !hasVat
          items: [{ brand: 'Oppo', model: 'A78', quantity: 3, unitPrice: 500 }],
        } as never,
        'user-1',
      );

      const data = lastCreateArg.data;
      expect(data.totalAmount.toString()).toBe('1500');
      expect(data.discount.toString()).toBe('50');
      expect(data.vatAmount.toString()).toBe('0');
      // discountAfterVat is zeroed when supplier has no VAT.
      expect(data.discountAfterVat.toString()).toBe('0');
      expect(data.netAmount.toString()).toBe('1450');
    });
  });

  describe('dueDate derivation from supplier credit terms', () => {
    it('derives dueDate = orderDate + creditTermDays from the default payment method', async () => {
      // orderDate 2026-06-01, default method credit term 30 days → 2026-07-01
      await makeService({
        deletedAt: null,
        hasVat: true,
        paymentMethods: [
          {
            paymentMethod: 'TRANSFER',
            creditTermDays: 30,
            isDefault: true,
            bankName: 'KBank',
            bankAccountNumber: '111-2-33333-4',
          },
        ],
      });

      await service.create(
        {
          supplierId: 'sup-1',
          orderDate: '2026-06-01',
          items: [{ quantity: 1, unitPrice: 100 }],
        } as never,
        'user-1',
      );

      const data = lastCreateArg.data;
      const expected = new Date('2026-06-01');
      expected.setDate(expected.getDate() + 30);
      expect(data.dueDate).toBeInstanceOf(Date);
      expect((data.dueDate as Date).getTime()).toBe(expected.getTime());

      // Snapshots the selected method's bank fields at create time.
      expect(data.bankAccountSnapshot).toBe('111-2-33333-4');
      expect(data.bankNameSnapshot).toBe('KBank');
    });

    it('uses the dto.paymentMethod-matched method when paymentMethod is provided', async () => {
      // Two methods: default TRANSFER(30) and CHEQUE(60). dto asks for CHEQUE → 60 days.
      await makeService({
        deletedAt: null,
        hasVat: true,
        paymentMethods: [
          { paymentMethod: 'TRANSFER', creditTermDays: 30, isDefault: true, bankName: 'KBank', bankAccountNumber: 'AAA' },
          { paymentMethod: 'CHEQUE', creditTermDays: 60, isDefault: false, bankName: 'SCB', bankAccountNumber: 'BBB' },
        ],
      });

      await service.create(
        {
          supplierId: 'sup-1',
          orderDate: '2026-06-01',
          paymentMethod: 'CHEQUE',
          items: [{ quantity: 1, unitPrice: 100 }],
        } as never,
        'user-1',
      );

      const data = lastCreateArg.data;
      const expected = new Date('2026-06-01');
      expected.setDate(expected.getDate() + 60);
      expect((data.dueDate as Date).getTime()).toBe(expected.getTime());
      expect(data.bankAccountSnapshot).toBe('BBB');
      expect(data.bankNameSnapshot).toBe('SCB');
      expect(data.paymentMethod).toBe('CHEQUE');
    });

    it('leaves dueDate null when no payment method has credit terms', async () => {
      await makeService({ deletedAt: null, hasVat: true, paymentMethods: [] });

      await service.create(
        {
          supplierId: 'sup-1',
          orderDate: '2026-06-01',
          items: [{ quantity: 1, unitPrice: 100 }],
        } as never,
        'user-1',
      );

      const data = lastCreateArg.data;
      expect(data.dueDate).toBeNull();
      expect(data.bankAccountSnapshot).toBeNull();
      expect(data.bankNameSnapshot).toBeNull();
    });
  });
});

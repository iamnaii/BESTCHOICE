import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { poJournalTestProviders } from './po-journal.test-helpers';

/** สเปค 2026-11-19 ข้อ 3.2 — รับของจากใบสั่งซื้อ: ราคาขาย GFIN เติมจากราคากลางแม้กรอกราคาขายมาเอง */
describe('goodsReceiving — ราคาขาย GFIN ของเครื่องที่รับเข้า', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  const TEMPLATE = {
    id: 't16', brand: 'Apple', model: 'iPhone 16', storage: '', category: 'PHONE_NEW',
    hasWarranty: false, deviceOrigin: 'UNSPECIFIED',
    cashPrice: new Prisma.Decimal('30900'),
    installmentBestchoicePrice: new Prisma.Decimal('31900'),
    installmentFinancePrice: new Prisma.Decimal('32900'),
  };

  beforeEach(async () => {
    const items = [{ id: 'poi-1', brand: 'Apple', model: 'iPhone 16', quantity: 5, receivedQty: 0, category: 'PHONE_NEW', accessoryType: null, accessoryBrand: null, color: null, storage: null, unitPrice: 30000 }];
    tx = {
      purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue({ id: 'po-1', status: 'APPROVED', deletedAt: null, supplierId: 'sup-1', supplier: { id: 'sup-1', name: 'Sup' }, items }),
        update: jest.fn().mockResolvedValue({}),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn().mockResolvedValue({ id: 'gri1' }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      product: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prod-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      productPrice: {
        create: jest.fn().mockResolvedValue({ id: 'row-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([TEMPLATE]) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      pOItem: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve(items.map((i) => ({ ...i })))),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = { $transaction: jest.fn().mockImplementation(async (fn: any) => (typeof fn === 'function' ? fn(tx) : Promise.all(fn))) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }, ...poJournalTestProviders().providers],
    }).compile();
    service = module.get(PurchaseOrdersService);
  });

  const financeWrites = () =>
    tx.product.update.mock.calls.filter(([args]: [{ data: Record<string, unknown> }]) => args.data.financePrice !== undefined);

  it('กรอกราคาขายตอนรับ → ราคาเงินสดตามที่กรอก แต่ราคาขาย GFIN มาจากราคากลาง', async () => {
    await service.goodsReceiving('po-1', { items: [{ poItemId: 'poi-1', status: 'PASS', imeiSerial: 'IMEI-FIN-1', sellingPrice: 29900 }] } as never, 'user-1');
    expect(financeWrites()).toHaveLength(1);
    expect(financeWrites()[0][0]).toEqual({ where: { id: 'prod-1' }, data: { financePrice: new Prisma.Decimal('32900') } });
    const cashWrite = tx.product.update.mock.calls.find(([args]: [{ data: Record<string, unknown> }]) => args.data.cashPrice !== undefined);
    expect(cashWrite[0].data.cashPrice.toString()).toBe('29900');
  });

  it('ไม่กรอกราคา → เติมเงินสด + ผ่อนจากราคากลาง และราคาขาย GFIN อีกขั้น', async () => {
    await service.goodsReceiving('po-1', { items: [{ poItemId: 'poi-1', status: 'PASS', imeiSerial: 'IMEI-FIN-2' }] } as never, 'user-1');
    const autofill = tx.product.update.mock.calls.find(([args]: [{ data: Record<string, unknown> }]) => args.data.cashPrice !== undefined);
    expect(autofill[0].data.cashPrice.toString()).toBe('30900');
    expect(autofill[0].data.installmentPrice.toString()).toBe('31900');
    expect(financeWrites()[0][0].data.financePrice.toString()).toBe('32900');
  });
});

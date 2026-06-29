import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * B3 supplier-direct receive = auto-PO. ONE $transaction:
 *  create PO (isDirectReceive, unitPrice=costPrice) -> set APPROVED/ORDERED
 *  (approval-bypass + AuditLog) -> run goodsReceiving() to make GR + products.
 * No JE; poId never null.
 */
describe('PurchaseOrdersService.directReceive — auto-PO supplier receive', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeTx = () => {
    const created: Record<string, unknown[]> = {
      po: [], poUpdate: [], audit: [], gr: [], gri: [], product: [], price: [], poItemUpdate: [],
    };
    const poItems = [{ id: 'poi-1', category: 'PHONE_NEW', brand: 'Apple', model: 'iPhone 16',
      color: null, storage: '256GB', accessoryType: null, accessoryBrand: null,
      quantity: 1, receivedQty: 0, unitPrice: 30000 }];
    const tx: any = {
      purchaseOrder: {
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockImplementation(({ data }) => {
          created.po.push(data);
          return Promise.resolve({ id: 'po-new', poNumber: 'PO-2099-01-003', supplierId: data.supplierId,
            status: data.status, isDirectReceive: data.isDirectReceive, deletedAt: null,
            supplier: { id: data.supplierId, name: 'ACME' },
            items: poItems });
        }),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve({ id: 'po-new', status: 'ORDERED',
          deletedAt: null, supplierId: 'sup-1', supplier: { id: 'sup-1', name: 'ACME' },
          items: poItems.map((i) => ({ ...i })) })),
        update: jest.fn().mockImplementation(({ data }) => { created.poUpdate.push(data); return Promise.resolve({ id: 'po-new', status: data.status }); }),
      },
      auditLog: { create: jest.fn().mockImplementation(({ data }) => { created.audit.push(data); return Promise.resolve({}); }) },
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'sup-1', deletedAt: null }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn().mockImplementation(({ data }) => { created.gri.push(data); return Promise.resolve({ id: 'gri1', ...data }); }) },
      pOItem: {
        findMany: jest.fn().mockImplementation(({ where: { id: { in: ids } } }) =>
          Promise.resolve(poItems.filter((i) => ids.includes(i.id)).map((i) => ({ ...i })))),
        update: jest.fn().mockImplementation(({ data }) => { created.poItemUpdate.push(data); return Promise.resolve({}); }),
      },
      product: {
        create: jest.fn().mockImplementation(({ data }) => { created.product.push(data); return Promise.resolve({ id: 'prod-1', ...data }); }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productPrice: { create: jest.fn().mockImplementation(({ data }) => { created.price.push(data); return Promise.resolve({}); }) },
    };
    return { tx, created };
  };

  const build = async (prisma: any) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  const baseDto = () => ({
    supplierId: 'sup-1',
    orderDate: '2099-01-15',
    items: [{
      category: 'PHONE_NEW', brand: 'Apple', model: 'iPhone 16', storage: '256GB',
      quantity: 1, unitPrice: 30000, status: 'PASS', imeiSerial: 'IMEI-1', serialNumber: 'SN-1', sellingPrice: 39900,
    }],
  });

  it('creates an isDirectReceive PO at ORDERED, writes an approval-bypass AuditLog, and runs goodsReceiving', async () => {
    const { tx, created } = makeTx();
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);

    const result = await service.directReceive(baseDto() as never, 'user-1');

    // PO created with the auto-PO flags + cost as unitPrice
    expect(created.po[0]).toEqual(expect.objectContaining({ supplierId: 'sup-1', isDirectReceive: true, status: 'APPROVED' }));
    expect((created.po[0] as any).items.create[0]).toEqual(expect.objectContaining({ unitPrice: 30000, quantity: 1 }));
    // advanced APPROVED -> ORDERED
    expect(created.poUpdate.some((u: any) => u.status === 'ORDERED' && u.orderedAt instanceof Date)).toBe(true);
    // approval-bypass audit row
    expect(created.audit[0]).toEqual(expect.objectContaining({ userId: 'user-1', action: 'PO_DIRECT_RECEIVE_APPROVAL_BYPASS', entity: 'purchase_order', entityId: 'po-new' }));
    // product created with costPrice from unitPrice
    expect(created.product[0]).toEqual(expect.objectContaining({ costPrice: 30000, imeiSerial: 'IMEI-1' }));
    // GR result surfaced
    expect(result).toEqual(expect.objectContaining({ poId: 'po-new', poNumber: 'PO-2099-01-003', receivingId: 'gr1', passed: 1, rejected: 0 }));
  });

  it('rejects a missing/zero costPrice (COGS would silently break)', async () => {
    const { tx } = makeTx();
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);
    const dto = baseDto();
    dto.items[0].unitPrice = 0;
    await expect(service.directReceive(dto as never, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when the supplier does not exist', async () => {
    const { tx } = makeTx();
    tx.supplier.findUnique = jest.fn().mockResolvedValue(null);
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);
    await expect(service.directReceive(baseDto() as never, 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('persists structured defectReason on a REJECT unit', async () => {
    const { tx, created } = makeTx();
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);
    const dto = baseDto();
    dto.items[0] = { ...dto.items[0], status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' } as never;
    await service.directReceive(dto as never, 'user-1');
    expect(created.gri[0]).toEqual(expect.objectContaining({ status: 'REJECT', defectReason: 'SCREEN', rejectReason: 'จอแตก' }));
  });
});

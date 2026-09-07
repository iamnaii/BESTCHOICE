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
  const makeTx = ({ category = 'PHONE_NEW' }: { category?: string } = {}) => {
    const created: Record<string, unknown[]> = {
      po: [], poUpdate: [], audit: [], gr: [], gri: [], product: [], price: [], poItemUpdate: [], photo: [],
    };
    const poItems = [{ id: 'poi-1', category, brand: 'Apple', model: 'iPhone 16',
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
        update: jest.fn().mockResolvedValue({}),
      },
      productPhoto: {
        create: jest.fn().mockImplementation(({ data }) => { created.photo.push(data); return Promise.resolve({ id: 'pp1', ...data }); }),
      },
      productPrice: {
        create: jest.fn().mockImplementation(({ data }) => { created.price.push(data); return Promise.resolve({}); }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
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
    // B0 §2.1: sellingPrice writes cashPrice via the column write-through path —
    // label is 'ราคาเงินสด' (CASH_LABEL), not the old hardcoded 'ราคาขาย'
    expect(created.price[0]).toEqual(expect.objectContaining({ label: 'ราคาเงินสด' }));
    // GR result surfaced
    expect(result).toEqual(expect.objectContaining({ poId: 'po-new', poNumber: 'PO-2099-01-003', receivingId: 'gr1', passed: 1, rejected: 0 }));
  });

  // 2026-09-07: the shop sells at two prices — a receive keys in ราคาเงินสด + ราคาผ่อน and both
  // land on the product columns and their ProductPrice rows in one write-through
  it('writes installmentPrice next to the cash price (column + ราคาผ่อน BESTCHOICE row)', async () => {
    const { tx, created } = makeTx();
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);
    const dto = baseDto();
    (dto.items[0] as any).installmentPrice = 43900;

    await service.directReceive(dto as never, 'user-1');

    const priceUpdate = tx.product.update.mock.calls.map((c: any) => c[0].data).find((d: any) => d.cashPrice || d.installmentPrice);
    expect(Number(priceUpdate.cashPrice)).toBe(39900);
    expect(Number(priceUpdate.installmentPrice)).toBe(43900);
    expect(created.price.map((p: any) => [p.label, Number(p.amount)])).toEqual([
      ['ราคาเงินสด', 39900],
      ['ราคาผ่อน BESTCHOICE', 43900],
    ]);
  });

  // 2026-09-07 (คำสั่งเจ้าของ "ตอนรับเครื่องหน้า PO ด้วย ให้มี 6 มุม"): รูป 6 มุมถ่ายได้ตั้งแต่ตอนรับ
  // ครบ + มีราคา → เข้าคลังพร้อมขายทันที ไม่ผ่านคิว; ไม่ครบ → รอถ่ายรูป โดยมุมที่ถ่ายแล้วถูกเก็บไว้
  describe('มือสอง + รูป 6 มุมตอนรับ', () => {
    const angles = (n: number) =>
      Object.fromEntries(['front', 'back', 'left', 'right', 'top', 'bottom'].slice(0, n).map((a) => [a, `data:${a}`]));
    const usedDto = (n: number) => {
      const dto = baseDto();
      (dto.items[0] as any).category = 'PHONE_USED';
      (dto.items[0] as any).installmentPrice = 43900;
      (dto.items[0] as any).anglePhotos = angles(n);
      return dto;
    };

    it('ครบ 6 มุม + สองราคา → IN_STOCK ทันที และแถวรูป isCompleted', async () => {
      const { tx, created } = makeTx({ category: 'PHONE_USED' });
      const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
      const service = await build(prisma);
      await service.directReceive(usedDto(6) as never, 'user-1');
      expect(created.product[0]).toEqual(expect.objectContaining({ category: 'PHONE_USED', status: 'IN_STOCK' }));
      expect(created.photo[0]).toEqual(
        expect.objectContaining({ productId: 'prod-1', front: 'data:front', bottom: 'data:bottom', isCompleted: true, uploadedById: 'user-1' }),
      );
    });

    it('ถ่ายไม่ครบ → PHOTO_PENDING (เข้าคิว) แต่มุมที่ถ่ายแล้วถูกเก็บ', async () => {
      const { tx, created } = makeTx({ category: 'PHONE_USED' });
      const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
      const service = await build(prisma);
      await service.directReceive(usedDto(4) as never, 'user-1');
      expect(created.product[0]).toEqual(expect.objectContaining({ status: 'PHOTO_PENDING' }));
      expect(created.photo[0]).toEqual(expect.objectContaining({ right: 'data:right', isCompleted: false }));
      expect((created.photo[0] as any).top).toBeUndefined();
    });

    it('ไม่ได้ถ่ายเลย → PHOTO_PENDING และไม่สร้างแถวรูป', async () => {
      const { tx, created } = makeTx({ category: 'PHONE_USED' });
      const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
      const service = await build(prisma);
      await service.directReceive(usedDto(0) as never, 'user-1');
      expect(created.product[0]).toEqual(expect.objectContaining({ status: 'PHOTO_PENDING' }));
      expect(created.photo).toHaveLength(0);
    });

    it('ครบ 6 มุมแต่ไม่มีราคา → ยังรอถ่ายรูป (ด่านราคาของการเข้าคลังยังอยู่)', async () => {
      const { tx, created } = makeTx({ category: 'PHONE_USED' });
      const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
      const service = await build(prisma);
      const dto = usedDto(6);
      delete (dto.items[0] as any).sellingPrice;
      delete (dto.items[0] as any).installmentPrice;
      await service.directReceive(dto as never, 'user-1');
      expect(created.product[0]).toEqual(expect.objectContaining({ status: 'PHOTO_PENDING' }));
      expect(created.photo[0]).toEqual(expect.objectContaining({ isCompleted: true }));
    });

    it('เครื่องใหม่ละเลย anglePhotos (ไม่มีแถวรูป, IN_STOCK ตามเดิม)', async () => {
      const { tx, created } = makeTx();
      const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
      const service = await build(prisma);
      const dto = baseDto();
      (dto.items[0] as any).anglePhotos = angles(6);
      await service.directReceive(dto as never, 'user-1');
      expect(created.product[0]).toEqual(expect.objectContaining({ status: 'IN_STOCK' }));
      expect(created.photo).toHaveLength(0);
    });
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

  // 2026-09-06: a direct receive used to book netAmount = totalAmount (no VAT, no discount) and
  // always UNPAID, so a VAT supplier's payable was 7% short on the AP tab and a cash purchase
  // paid on the spot still showed as owed. It now uses the same money math + terms as create().
  it("applies the supplier's VAT, discounts and credit terms exactly like create()", async () => {
    const { tx, created } = makeTx();
    tx.supplier.findUnique = jest.fn().mockResolvedValue({
      id: 'sup-1', deletedAt: null, hasVat: true,
      paymentMethods: [{ paymentMethod: 'CREDIT', creditTermDays: 30, isDefault: true, bankName: 'KBank', bankAccountNumber: '123-4-56789-0' }],
    });
    tx.systemConfig.findMany = jest.fn().mockResolvedValue([]); // no VAT_RATE row → 7%
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);

    const dto = { ...baseDto(), discount: 900, discountAfterVat: 40 };
    dto.items[0].unitPrice = 42900;
    await service.directReceive(dto as never, 'user-1');

    const po: any = created.po[0];
    expect(Number(po.totalAmount)).toBe(42900);
    expect(Number(po.discount)).toBe(900);
    expect(Number(po.vatAmount)).toBe(2940); // (42900 − 900) × 0.07
    expect(Number(po.discountAfterVat)).toBe(40);
    expect(Number(po.netAmount)).toBe(44900); // 42000 + 2940 − 40
    expect(po.dueDate).toEqual(new Date('2099-02-14T00:00:00.000Z')); // orderDate + 30 days credit
    expect(po.bankAccountSnapshot).toBe('123-4-56789-0');
    expect(po.bankNameSnapshot).toBe('KBank');
  });

  it('records a payment made on the spot on the auto-PO (defaults to UNPAID when absent)', async () => {
    const { tx, created } = makeTx();
    tx.systemConfig.findMany = jest.fn().mockResolvedValue([]);
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);

    await service.directReceive({ ...baseDto(), paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: 30000, paymentNotes: 'จ่ายสดหน้าร้าน' } as never, 'user-1');
    expect(created.po[0]).toEqual(expect.objectContaining({ paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: 30000, paymentNotes: 'จ่ายสดหน้าร้าน' }));

    await service.directReceive(baseDto() as never, 'user-1');
    expect(created.po[1]).toEqual(expect.objectContaining({ paymentStatus: 'UNPAID', paidAmount: 0 }));
    expect(Number((created.po[1] as any).netAmount)).toBe(30000); // supplier without VAT: net = total
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

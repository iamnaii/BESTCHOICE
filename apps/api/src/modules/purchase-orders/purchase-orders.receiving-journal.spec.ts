import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { poJournalTestProviders, TEST_JOURNAL_ENTRY_NO, TEST_SHOP_COMPANY_ID } from './po-journal.test-helpers';

/**
 * รับสินค้าเข้า → ลงบัญชี (คำตัดสินเจ้าของ + คำตอบฝ่ายบัญชี 2026-09-29 ข้อ ข1 ข2 ข5)
 *
 *  - ต้นทุนของเครื่อง (`Product.costPrice`) = ราคารวม VAT หลังแบ่งส่วนลดท้ายบิลตามสัดส่วนราคา
 *  - หนึ่งใบรับของ = หนึ่งรายการ Dr สินค้าคงคลัง / Cr เจ้าหนี้ผู้จัดจำหน่าย ใน transaction เดียวกัน
 *  - ปันแบบปัดสะสม: หน่วยลำดับที่ k ของรายการได้ต้นทุนตัวเดิมเสมอ ไม่ว่าจะรับกี่ครั้ง —
 *    ต้นทุนรวมทั้งใบ = ยอดสุทธิพอดี ไม่มีเศษให้ลงทีหลัง
 */
describe('PurchaseOrdersService — รับสินค้าเข้าลงบัญชี', () => {
  type PoItem = {
    id: string;
    category: string;
    quantity: number;
    receivedQty: number;
    unitPrice: string;
  };

  type PoAmounts = {
    totalAmount: string;
    netAmount: string;
    discount?: string;
    vatAmount?: string;
    discountAfterVat?: string;
    items: PoItem[];
  };

  const makeTx = (po: PoAmounts) => {
    const created = { product: [] as Record<string, unknown>[], gr: [] as unknown[], gri: [] as Record<string, unknown>[] };
    const poItems = po.items.map((i, index) => ({
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)),
      brand: 'Apple',
      model: 'iPhone 16',
      color: null,
      storage: '256GB',
      accessoryType: null,
      accessoryBrand: null,
      deletedAt: null,
      ...i,
      unitPrice: new Prisma.Decimal(i.unitPrice),
    }));
    const poRow = () => ({
      id: 'po-1',
      poNumber: 'PO-2026-09-001',
      status: 'ORDERED',
      deletedAt: null,
      supplierId: 'sup-1',
      supplier: { id: 'sup-1', name: 'ACME' },
      totalAmount: new Prisma.Decimal(po.totalAmount),
      discount: new Prisma.Decimal(po.discount ?? 0),
      vatAmount: new Prisma.Decimal(po.vatAmount ?? 0),
      discountAfterVat: new Prisma.Decimal(po.discountAfterVat ?? 0),
      netAmount: new Prisma.Decimal(po.netAmount),
      items: poItems.map((i) => ({ ...i })),
    });
    let productSeq = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx: any = {
      // ก้อน 2: หักมัดจำตอนรับของถามก่อนว่าเคยมัดจำไหม — spec นี้ไม่มีมัดจำ
      purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      purchaseOrder: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(poRow())),
        update: jest.fn().mockResolvedValue({}),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: {
        create: jest.fn().mockImplementation(({ data }) => {
          created.gr.push(data);
          return Promise.resolve({ id: 'gr1', grNumber: data.grNumber, createdAt: new Date('2026-09-29T03:00:00.000Z') });
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      goodsReceivingItem: {
        create: jest.fn().mockImplementation(({ data }) => {
          created.gri.push(data);
          return Promise.resolve({ id: `gri-${created.gri.length}`, ...data });
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pOItem: {
        findMany: jest.fn().mockImplementation(({ where: { id: { in: ids } } }) =>
          Promise.resolve(poItems.filter((i) => ids.includes(i.id)).map((i) => ({ ...i }))),
        ),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const row = poItems.find((i) => i.id === where.id)!;
          row.receivedQty = data.receivedQty;
          return Promise.resolve({});
        }),
      },
      product: {
        create: jest.fn().mockImplementation(({ data }) => {
          created.product.push(data);
          productSeq += 1;
          return Promise.resolve({ id: `prod-${productSeq}`, deviceOrigin: null, ...data });
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      productPhoto: { create: jest.fn().mockResolvedValue({}) },
      productPrice: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    return { tx, created };
  };

  const build = async (tx: unknown) => {
    const journal = poJournalTestProviders();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }, ...journal.providers],
    }).compile();
    return { service: module.get<PurchaseOrdersService>(PurchaseOrdersService), journal, prisma };
  };

  const pass = (poItemId: string, imeiSerial?: string) => ({ poItemId, imeiSerial, status: 'PASS' });
  const costs = (rows: Record<string, unknown>[]) => rows.map((r) => (r.costPrice as Prisma.Decimal).toFixed(2));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postedUnits = (journal: any) =>
    journal.goodsReceivingTemplate.execute.mock.calls[0][0].units.map(
      (u: { inventoryAccountCode: string; payableAccountCode: string; cost: Prisma.Decimal }) => [
        u.inventoryAccountCode,
        u.payableAccountCode,
        u.cost.toFixed(2),
      ],
    );

  it('ข2 — ผู้จัดจำหน่ายจด VAT: ต้นทุนเครื่องเป็นราคารวม VAT และลงบัญชีด้วยยอดเดียวกัน', async () => {
    // 2 × 10,000 + VAT 1,400 = 21,400 · รับครั้งนี้ 1 เครื่อง
    const { tx, created } = makeTx({
      totalAmount: '20000',
      vatAmount: '1400',
      netAmount: '21400',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 2, receivedQty: 0, unitPrice: '10000' }],
    });
    const { service, journal } = await build(tx);

    const result = await service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-1')] } as never, 'user-1');

    expect(created.product[0].costPrice).toBeInstanceOf(Prisma.Decimal);
    expect(costs(created.product)).toEqual(['10700.00']);
    expect(journal.goodsReceivingTemplate.execute).toHaveBeenCalledTimes(1);
    const [input, passedTx] = journal.goodsReceivingTemplate.execute.mock.calls[0];
    expect(passedTx).toBe(tx);
    expect(input).toEqual(
      expect.objectContaining({
        idempotencyKey: 'shop-goods-receiving:gr1',
        receivingId: 'gr1',
        grNumber: expect.stringMatching(/^GR-/),
        poId: 'po-1',
        poNumber: 'PO-2026-09-001',
        postedAt: new Date('2026-09-29T03:00:00.000Z'),
      }),
    );
    expect(postedUnits(journal)).toEqual([['S11-2001', 'S21-1101', '10700.00']]);
    expect(result).toEqual(expect.objectContaining({ status: 'PARTIALLY_RECEIVED', journalEntryNo: TEST_JOURNAL_ENTRY_NO }));
  });

  it('ข5 — ส่วนลดท้ายบิลแบ่งตามสัดส่วนราคา · ใบผสมแยกบัญชีสินค้าและเจ้าหนี้ตามหมวด', async () => {
    // มือถือ 10,000 + อุปกรณ์ 5,000 = 15,000 − 300 = 14,700 + VAT 1,029 = 15,729
    const { tx, created } = makeTx({
      totalAmount: '15000',
      discount: '300',
      vatAmount: '1029',
      netAmount: '15729',
      items: [
        { id: 'poi-phone', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '10000' },
        { id: 'poi-acc', category: 'ACCESSORY', quantity: 1, receivedQty: 0, unitPrice: '5000' },
      ],
    });
    const { service, journal } = await build(tx);

    const result = await service.goodsReceiving(
      'po-1',
      { items: [pass('poi-phone', 'IMEI-1'), pass('poi-acc')] } as never,
      'user-1',
    );

    expect(costs(created.product)).toEqual(['10486.00', '5243.00']);
    expect(postedUnits(journal)).toEqual([
      ['S11-2001', 'S21-1101', '10486.00'],
      ['S11-2003', 'S21-1102', '5243.00'],
    ]);
    expect(result.status).toBe('FULLY_RECEIVED');
  });

  const fullAngles = { front: 'f', back: 'b', left: 'l', right: 'r', top: 't', bottom: 'u' };

  it('มือถือมือสองและแท็บเล็ต: สินค้าแยกบัญชี เจ้าหนี้บัญชีมือถือ (มือสองถ่ายรูปครบ + มีราคา = เข้าคลังทันที)', async () => {
    const { tx } = makeTx({
      totalAmount: '9000',
      netAmount: '9000',
      items: [
        { id: 'poi-used', category: 'PHONE_USED', quantity: 1, receivedQty: 0, unitPrice: '4000' },
        { id: 'poi-tab', category: 'TABLET', quantity: 1, receivedQty: 0, unitPrice: '5000' },
      ],
    });
    const { service, journal } = await build(tx);

    await service.goodsReceiving(
      'po-1',
      {
        items: [
          { ...pass('poi-used', 'IMEI-U'), anglePhotos: fullAngles, sellingPrice: 5900 },
          pass('poi-tab', 'IMEI-T'),
        ],
      } as never,
      'user-1',
    );

    expect(postedUnits(journal)).toEqual([
      ['S11-2002', 'S21-1101', '4000.00'],
      ['S11-2001', 'S21-1101', '5000.00'],
    ]);
  });

  // คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8: "ลงสินค้าเข้าคลังและเจ้าหนี้ โดยไม่ลงสินค้าที่ไม่รับเข้าคลัง"
  it('ข้อ 8 — มือสองที่ต้องรอถ่ายรูปยังไม่รับเข้าคลัง: ไม่ลงบัญชีตอนรับของ แต่เก็บต้นทุนไว้ลงตอนผ่านเข้าคลัง', async () => {
    const { tx, created } = makeTx({
      totalAmount: '9000',
      netAmount: '9000',
      items: [
        { id: 'poi-used', category: 'PHONE_USED', quantity: 1, receivedQty: 0, unitPrice: '4000' },
        { id: 'poi-tab', category: 'TABLET', quantity: 1, receivedQty: 0, unitPrice: '5000' },
      ],
    });
    const { service, journal } = await build(tx);

    const result = await service.goodsReceiving(
      'po-1',
      { items: [pass('poi-used', 'IMEI-U'), pass('poi-tab', 'IMEI-T')] } as never,
      'user-1',
    );

    expect(created.product.map((p) => p.status)).toEqual(['PHOTO_PENDING', 'IN_STOCK']);
    expect(postedUnits(journal)).toEqual([['S11-2001', 'S21-1101', '5000.00']]);
    // ต้นทุนของทุกหน่วยเก็บไว้ที่แถวใบรับของ — หน่วยที่รอถ่ายรูปใช้ยอดนี้ตอนผ่านเข้าคลัง
    expect(created.gri.map((g) => (g.receivedCost as Prisma.Decimal).toFixed(2))).toEqual(['4000.00', '5000.00']);
    // ผูกรายการบัญชีเฉพาะแถวที่ลงแล้ว (แท็บเล็ต = แถวที่ 2)
    expect(tx.goodsReceivingItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['gri-2'] } },
      data: { journalEntryId: 'je-test-1' },
    });
    expect(result).toMatchObject({ journalEntryNo: TEST_JOURNAL_ENTRY_NO, unitsAwaitingStockEntry: 1 });
  });

  it('ข้อ 8 — ทุกหน่วยรอถ่ายรูป: ไม่เรียกตัวลงบัญชี ใบรับของไม่มีรายการ', async () => {
    const { tx } = makeTx({
      totalAmount: '8000',
      netAmount: '8000',
      items: [{ id: 'poi-used', category: 'PHONE_USED', quantity: 2, receivedQty: 0, unitPrice: '4000' }],
    });
    const { service, journal } = await build(tx);

    const result = await service.goodsReceiving(
      'po-1',
      { items: [pass('poi-used', 'IMEI-U1'), pass('poi-used', 'IMEI-U2')] } as never,
      'user-1',
    );

    expect(journal.goodsReceivingTemplate.execute).not.toHaveBeenCalled();
    expect(tx.goodsReceivingItem.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ journalEntryNo: null, unitsAwaitingStockEntry: 2 });
  });

  it('หน่วยที่ตรวจไม่ผ่านไม่มีต้นทุนและไม่เข้ารายการบัญชี', async () => {
    const { tx, created } = makeTx({
      totalAmount: '20000',
      vatAmount: '1400',
      netAmount: '21400',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 2, receivedQty: 0, unitPrice: '10000' }],
    });
    const { service, journal } = await build(tx);

    await service.goodsReceiving(
      'po-1',
      {
        items: [
          pass('poi-1', 'IMEI-1'),
          { poItemId: 'poi-1', imeiSerial: 'IMEI-2', status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' },
        ],
      } as never,
      'user-1',
    );

    expect(created.product).toHaveLength(1);
    expect(postedUnits(journal)).toEqual([['S11-2001', 'S21-1101', '10700.00']]);
  });

  it('รับแล้วตรวจไม่ผ่านทั้งใบ → ไม่เรียกตัวลงบัญชี และ journalEntryNo เป็น null', async () => {
    const { tx } = makeTx({
      totalAmount: '10000',
      vatAmount: '700',
      netAmount: '10700',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '10000' }],
    });
    const { service, journal } = await build(tx);

    const result = await service.goodsReceiving(
      'po-1',
      { items: [{ poItemId: 'poi-1', imeiSerial: 'IMEI-1', status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' }] } as never,
      'user-1',
    );

    expect(journal.goodsReceivingTemplate.execute).not.toHaveBeenCalled();
    expect(result.journalEntryNo).toBeNull();
  });

  describe('เศษสตางค์ — ปันแบบปัดสะสม', () => {
    // 3 × 3,333.33 = 9,999.99 − ส่วนลด 0.01 = 9,999.98 → หน่วยที่ 1–3 = 3,333.33 / 3,333.32 / 3,333.33
    const po = (receivedQty: number): PoAmounts => ({
      totalAmount: '9999.99',
      discount: '0.01',
      netAmount: '9999.98',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 3, receivedQty, unitPrice: '3333.33' }],
    });

    it('รับสองเครื่องแรก ได้ต้นทุนของหน่วยที่ 1 และ 2', async () => {
      const { tx, created } = makeTx(po(0));
      const { service } = await build(tx);
      await service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-1'), pass('poi-1', 'IMEI-2')] } as never, 'user-1');
      expect(costs(created.product)).toEqual(['3333.33', '3333.32']);
    });

    it('รับเครื่องสุดท้ายทีหลัง ได้ต้นทุนของหน่วยที่ 3 → รวมทั้งใบ = ยอดสุทธิพอดี', async () => {
      const { tx, created } = makeTx(po(2));
      const { service, journal } = await build(tx);
      const result = await service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-3')] } as never, 'user-1');
      expect(costs(created.product)).toEqual(['3333.33']);
      expect(postedUnits(journal)).toEqual([['S11-2001', 'S21-1101', '3333.33']]);
      expect(result.status).toBe('FULLY_RECEIVED');
    });

    it('รับครบในครั้งเดียว ได้ต้นทุนชุดเดียวกับรับสองครั้ง', async () => {
      const { tx, created } = makeTx(po(0));
      const { service } = await build(tx);
      await service.goodsReceiving(
        'po-1',
        { items: [pass('poi-1', 'IMEI-1'), pass('poi-1', 'IMEI-2'), pass('poi-1', 'IMEI-3')] } as never,
        'user-1',
      );
      expect(costs(created.product)).toEqual(['3333.33', '3333.32', '3333.33']);
    });

    it('หน่วยที่ตรวจไม่ผ่านไม่กินลำดับหน่วย', async () => {
      const { tx, created } = makeTx(po(0));
      const { service } = await build(tx);
      await service.goodsReceiving(
        'po-1',
        {
          items: [
            pass('poi-1', 'IMEI-1'),
            { poItemId: 'poi-1', imeiSerial: 'IMEI-X', status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' },
            pass('poi-1', 'IMEI-2'),
          ],
        } as never,
        'user-1',
      );
      expect(costs(created.product)).toEqual(['3333.33', '3333.32']);
    });

    it('ใบผสม: เศษของรายการราคาถูกอยู่ในรายการของมันเอง ไม่ไหลไปรายการอื่น', async () => {
      // เครื่อง 10,000 + อุปกรณ์ 3 × 0.15 = 10,000.45 · ส่วนลด 1,000.04 → ยอดสุทธิ 9,000.41
      // รายการเครื่อง 9,000.00 · รายการอุปกรณ์ 0.41 → 0.14 / 0.13 / 0.14
      const { tx, created } = makeTx({
        totalAmount: '10000.45',
        discount: '1000.04',
        netAmount: '9000.41',
        items: [
          { id: 'poi-phone', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '10000' },
          { id: 'poi-acc', category: 'ACCESSORY', quantity: 3, receivedQty: 0, unitPrice: '0.15' },
        ],
      });
      const { service, journal } = await build(tx);
      await service.goodsReceiving(
        'po-1',
        { items: [pass('poi-acc'), pass('poi-phone', 'IMEI-1'), pass('poi-acc'), pass('poi-acc')] } as never,
        'user-1',
      );
      expect(costs(created.product)).toEqual(['0.14', '9000.00', '0.13', '0.14']);
      expect(postedUnits(journal)).toEqual([
        ['S11-2003', 'S21-1102', '0.14'],
        ['S11-2001', 'S21-1101', '9000.00'],
        ['S11-2003', 'S21-1102', '0.13'],
        ['S11-2003', 'S21-1102', '0.14'],
      ]);
    });

    it('หน่วยราคาถูกจำนวนมาก + ส่วนลด: รับได้ ไม่มีต้นทุนติดลบ', async () => {
      // 1,000 × 1.00 − ส่วนลด 4.99 = 995.01 · รับ 3 ชิ้นสุดท้าย (หน่วยที่ 998–1000)
      const { tx, created } = makeTx({
        totalAmount: '1000',
        discount: '4.99',
        netAmount: '995.01',
        items: [{ id: 'poi-1', category: 'ACCESSORY', quantity: 1000, receivedQty: 997, unitPrice: '1' }],
      });
      const { service } = await build(tx);
      const result = await service.goodsReceiving(
        'po-1',
        { items: [pass('poi-1'), pass('poi-1'), pass('poi-1')] } as never,
        'user-1',
      );
      // หน่วยที่ 998 = 993.02 − 992.02 · 999 = 994.01 − 993.02 · 1000 = 995.01 − 994.01
      expect(costs(created.product)).toEqual(['1.00', '0.99', '1.00']);
      expect(result.status).toBe('FULLY_RECEIVED');
    });

    it('ของแถมราคาศูนย์รับเป็นชิ้นสุดท้าย: ต้นทุนศูนย์ ใบสั่งซื้อครบได้ ไม่มีรายการบัญชีของครั้งนั้น', async () => {
      // 3 × 3,333.33 + ของแถม 1 ชิ้น · ส่วนลด 100 → 9,899.99 · มือถือรับครบไปแล้ว
      const { tx, created } = makeTx({
        totalAmount: '9999.99',
        discount: '100',
        netAmount: '9899.99',
        items: [
          { id: 'poi-phone', category: 'PHONE_NEW', quantity: 3, receivedQty: 3, unitPrice: '3333.33' },
          { id: 'poi-gift', category: 'ACCESSORY', quantity: 1, receivedQty: 0, unitPrice: '0' },
        ],
      });
      const { service, journal } = await build(tx);
      // ตัวลงบัญชีตัวจริงคืน null เมื่อยอดรวมของใบเป็นศูนย์ (ไม่โพสต์ใบเปล่า)
      journal.goodsReceivingTemplate.execute.mockResolvedValueOnce(null);
      const result = await service.goodsReceiving('po-1', { items: [pass('poi-gift')] } as never, 'user-1');
      expect(costs(created.product)).toEqual(['0.00']);
      expect(postedUnits(journal)).toEqual([['S11-2003', 'S21-1102', '0.00']]);
      expect(result.status).toBe('FULLY_RECEIVED');
      expect(result.journalEntryNo).toBeNull();
    });
  });

  it('ยอดสุทธิที่เก็บไว้ไม่ตรงกับองค์ประกอบ (แถวเก่า/แถวที่ seed ตรง netAmount = 0) → ใช้ยอดที่คิดจากองค์ประกอบ', async () => {
    // 5 × 12,000 ไม่มี VAT ไม่มีส่วนลด แต่ netAmount ในฐาน = 0 (ค่า default ของคอลัมน์)
    const { tx, created } = makeTx({
      totalAmount: '60000',
      netAmount: '0',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 5, receivedQty: 1, unitPrice: '12000' }],
    });
    const { service, journal } = await build(tx);

    await service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-1')] } as never, 'user-1');

    expect(costs(created.product)).toEqual(['12000.00']);
    expect(postedUnits(journal)).toEqual([['S11-2001', 'S21-1101', '12000.00']]);
  });

  it('ทั้งสอง transaction ของการรับของตั้ง timeout 30 วินาที (ค่าเริ่มต้น 5 วินาทีไม่พอสำหรับใบใหญ่)', async () => {
    const { tx } = makeTx({
      totalAmount: '10000',
      vatAmount: '700',
      netAmount: '10700',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '10000' }],
    });
    const { service, prisma } = await build(tx);

    await service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-1')] } as never, 'user-1');

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable', timeout: 30_000 }),
    );
  });

  it('ใบสั่งซื้อที่ไม่มียอดเก็บไว้เลย (ข้อมูลเก่า) → ต้นทุน = ราคาต่อหน่วย', async () => {
    const { tx, created } = makeTx({
      totalAmount: '0',
      netAmount: '0',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '30000' }],
    });
    const { service } = await build(tx);
    await service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-1')] } as never, 'user-1');
    expect(costs(created.product)).toEqual(['30000.00']);
  });

  it('ยอดสุทธิติดลบ → ปฏิเสธด้วยข้อความไทย ก่อนสร้างใบรับของ', async () => {
    const { tx, created } = makeTx({
      totalAmount: '1000',
      discount: '1050',
      netAmount: '-50',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '1000' }],
    });
    const { service, journal } = await build(tx);

    const attempt = service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-1')] } as never, 'user-1');

    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow(/PO-2026-09-001.*ยอดสุทธิติดลบ/);
    // ข้อความต้องบอกทางที่ทำได้จริงทั้งสองกรณี: ยังไม่เคยรับของ (ยกเลิกได้) กับรับไปบางส่วนแล้ว (ปุ่มยกเลิกถูกซ่อน)
    await expect(attempt).rejects.toThrow(/ยังไม่เคยรับของ.*ยกเลิก PO.*รับของไปบางส่วนแล้ว/s);
    expect(created.gr).toHaveLength(0);
    expect(created.product).toHaveLength(0);
    expect(journal.goodsReceivingTemplate.execute).not.toHaveBeenCalled();
  });

  it('ตรวจงวดบัญชีของ SHOP ด้วยวันที่ลงบัญชีก่อนโพสต์', async () => {
    const { tx } = makeTx({
      totalAmount: '10000',
      vatAmount: '700',
      netAmount: '10700',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '10000' }],
    });
    const { service, journal } = await build(tx);

    await service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-1')] } as never, 'user-1');

    expect(journal.companyResolver.getShopCompanyId).toHaveBeenCalledWith(tx);
    const postedAt = new Date('2026-09-29T03:00:00.000Z');
    expect(tx.accountingPeriod.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_year_month: {
          companyId: TEST_SHOP_COMPANY_ID,
          year: postedAt.getFullYear(),
          month: postedAt.getMonth() + 1,
        },
      },
      select: { status: true },
    });
  });

  it('งวดบัญชีปิดและพ้นช่วงผ่อนผัน → การรับของไม่เกิด', async () => {
    const { tx } = makeTx({
      totalAmount: '10000',
      vatAmount: '700',
      netAmount: '10700',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '10000' }],
    });
    // ใบรับของลงวันที่ย้อนหลังไกล (งวดปิดแล้ว พ้น grace) — จำลองด้วย createdAt ของใบรับของ
    tx.goodsReceiving.create.mockImplementation(({ data }: { data: { grNumber: string } }) =>
      Promise.resolve({ id: 'gr1', grNumber: data.grNumber, createdAt: new Date('2020-01-15T03:00:00.000Z') }),
    );
    tx.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });
    const { service, journal } = await build(tx);

    await expect(
      service.goodsReceiving('po-1', { items: [pass('poi-1', 'IMEI-1')] } as never, 'user-1'),
    ).rejects.toThrow(/งวดที่ปิดแล้ว/);
    expect(journal.goodsReceivingTemplate.execute).not.toHaveBeenCalled();
  });

  it('รับเข้าตรง (ไม่มีใบสั่งซื้อล่วงหน้า) ลงบัญชีด้วยทางเดียวกัน', async () => {
    const { tx, created } = makeTx({
      totalAmount: '30000',
      vatAmount: '2100',
      netAmount: '32100',
      items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 1, receivedQty: 0, unitPrice: '30000' }],
    });
    tx.purchaseOrder.count = jest.fn().mockResolvedValue(2);
    tx.purchaseOrder.create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'po-1',
        poNumber: 'PO-2026-09-001',
        supplierId: data.supplierId,
        status: data.status,
        deletedAt: null,
        supplier: { id: 'sup-1', name: 'ACME' },
        items: [{ id: 'poi-1' }],
      }),
    );
    tx.auditLog = { create: jest.fn().mockResolvedValue({}) };
    tx.supplier = { findUnique: jest.fn().mockResolvedValue({ id: 'sup-1', deletedAt: null, hasVat: true, paymentMethods: [] }) };
    const { service, journal } = await build(tx);

    const result = await service.directReceive(
      {
        supplierId: 'sup-1',
        orderDate: '2026-09-29',
        items: [
          {
            category: 'PHONE_NEW',
            brand: 'Apple',
            model: 'iPhone 16',
            storage: '256GB',
            quantity: 1,
            unitPrice: 30000,
            status: 'PASS',
            imeiSerial: 'IMEI-1',
            sellingPrice: 39900,
          },
        ],
      } as never,
      'user-1',
    );

    expect(costs(created.product)).toEqual(['32100.00']);
    expect(postedUnits(journal)).toEqual([['S11-2001', 'S21-1101', '32100.00']]);
    expect(result).toEqual(expect.objectContaining({ poNumber: 'PO-2026-09-001', journalEntryNo: TEST_JOURNAL_ENTRY_NO }));
  });
});

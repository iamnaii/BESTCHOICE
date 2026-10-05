import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceivingAcceptanceJournal } from './receiving-acceptance-journal';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

/**
 * ลงบัญชีรับสินค้าตอนเครื่องผ่านเข้าคลัง — คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8
 * "ลงสินค้าเข้าคลังและเจ้าหนี้ โดยไม่ลงสินค้าที่ไม่รับเข้าคลัง"
 *
 * flow จริงบนฐานข้อมูล (รับของ → รอถ่ายรูป → ยืนยันรูป/ตีกลับ) อยู่ที่
 * `__tests__/po-receiving-journal.integration.spec.ts` — ไฟล์นี้คุมกิ่งที่ฐานจริงสร้างยาก
 * (งวดบัญชีของวันรับของปิดไปแล้ว) และกิ่งที่ต้องไม่ทำอะไร
 */
describe('ReceivingAcceptanceJournal.bookIfPending', () => {
  const D = (v: string) => new Prisma.Decimal(v);
  // เดือนในอดีตทั้งคู่ — ด่านงวดบัญชีมีช่วงผ่อนผันนับจากวันนี้ เดือนปัจจุบันจึง "ปิด" ไม่ได้จริงในเทสต์
  const receivedAt = new Date(2026, 6, 20, 10, 0, 0); // 20 ก.ค. 2569
  const acceptedAt = new Date(2026, 7, 3, 10, 0, 0); // 3 ส.ค. 2569

  const receivingRow = (over: Record<string, unknown> = {}) => ({
    id: 'gri-1',
    journalEntryId: null,
    receivedCost: D('4199.66'),
    receiving: { id: 'gr-1', grNumber: 'GR-2026-09-001', createdAt: receivedAt, receivedById: 'user-1', po: { id: 'po-1', poNumber: 'PO-2026-09-001', supplierId: 'sup-1', supplier: { name: 'ผู้จัดจำหน่ายทดสอบ' } } },
    poItem: { category: 'PHONE_USED' },
    // ผู้เรียกเปลี่ยนเครื่องเป็น IN_STOCK ใน tx เดียวกันก่อนเรียก
    product: { category: 'PHONE_USED', status: 'IN_STOCK', deletedAt: null },
    ...over,
  });

  const build = (opts: { item?: Record<string, unknown> | null; locked?: Record<string, unknown> | null; closed?: string[] } = {}) => {
    const item = opts.item === undefined ? { id: 'gri-1', receivedCost: D('4199.66'), journalEntryId: null } : opts.item;
    const locked = opts.locked === undefined ? receivingRow() : opts.locked;
    const closed = new Set(opts.closed ?? []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx: any = {
      // ก้อน 2: หักมัดจำตอนรับของถามก่อนว่าเคยมัดจำไหม — spec นี้ไม่มีมัดจำ
      purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      goodsReceivingItem: {
        findFirst: jest.fn().mockResolvedValue(item),
        findUnique: jest.fn().mockResolvedValue(locked),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountingPeriod: {
        findUnique: jest.fn().mockImplementation(({ where: { companyId_year_month: { year, month } } }) =>
          Promise.resolve(closed.has(`${year}-${month}`) ? { status: 'CLOSED' } : null),
        ),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: '0' }) },
      todo: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    };
    const template = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-202609-00100', journalEntryId: 'je-100' }) };
    const companies = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co') };
    const journal = new ReceivingAcceptanceJournal(null as never, {
      template: template as never,
      companies: companies as never,
      accounts: new ShopAccountResolver(null as never),
    });
    return { tx, template, journal };
  };

  it('เครื่องจากใบสั่งซื้อที่ยังไม่ลง: ลงหนึ่งหน่วยด้วยต้นทุนที่ปันไว้ตอนรับของ ลงวันที่เดียวกับใบรับของ แล้วผูกรายการกับแถว', async () => {
    const { tx, template, journal } = build();

    const result = await journal.bookIfPending(tx, 'prod-2', acceptedAt);

    expect(template.execute).toHaveBeenCalledWith(
      {
        idempotencyKey: 'shop-goods-receiving-unit:prod-2',
        receivingId: 'gr-1',
        grNumber: 'GR-2026-09-001',
        poId: 'po-1',
        poNumber: 'PO-2026-09-001',
        supplierId: 'sup-1',
        supplierName: 'ผู้จัดจำหน่ายทดสอบ',
        units: [{ productId: 'prod-2', inventoryAccountCode: 'S11-2002', payableAccountCode: 'S21-1101', cost: D('4199.66') }],
        acceptedProductId: 'prod-2',
        postedAt: receivedAt,
        postedOnAcceptanceDate: false,
        postedOnReceiveDate: false,
        supplierDocRef: null,
        supplierDocMetadata: {},
      },
      tx,
    );
    // ล็อกแถวก่อนอ่านค่าที่ใช้ตัดสิน — อ่านก่อนล็อก = ผู้มาทีหลังเห็นค่าเก่าแล้วลงซ้ำ
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.goodsReceivingItem.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.goodsReceivingItem.update).toHaveBeenCalledWith({ where: { id: 'gri-1' }, data: { journalEntryId: 'je-100' } });
    expect(result).toEqual({
      entryNo: 'JE-202609-00100',
      journalEntryId: 'je-100',
      postedAt: receivedAt,
      postedOnAcceptanceDate: false,
      postedOnReceiveDate: false,
    });
  });

  describe('ข3 — ใบรับของที่มีวันที่ในเอกสารผู้จัดจำหน่าย', () => {
    const docDate = new Date(2026, 5, 28); // 28 มิ.ย. 2569 — ก่อนวันรับของ
    const withDoc = () =>
      receivingRow({
        receiving: {
          id: 'gr-1',
          grNumber: 'GR-2026-09-001',
          createdAt: receivedAt,
          receivedById: 'user-1',
          supplierDocType: 'TAX_INVOICE',
          supplierDocNumber: 'IV-0123',
          supplierDocDate: docDate,
          po: { id: 'po-1', poNumber: 'PO-2026-09-001', supplierId: 'sup-1', supplier: { name: 'ผู้จัดจำหน่ายทดสอบ' } },
        },
      });

    it('งวดของวันในเอกสารเปิด → ลงวันที่ในเอกสาร (วันเดียวกับใบรับของ) + stamp เอกสาร', async () => {
      const { tx, template, journal } = build({ locked: withDoc() });

      const result = await journal.bookIfPending(tx, 'prod-2', acceptedAt);

      const input = template.execute.mock.calls[0][0];
      expect(input.postedAt).toBe(docDate);
      expect(input).toMatchObject({
        postedOnAcceptanceDate: false,
        postedOnReceiveDate: false,
        supplierDocRef: 'ใบกำกับภาษี IV-0123',
        supplierDocMetadata: { supplierDocType: 'TAX_INVOICE', supplierDocNumber: 'IV-0123' },
      });
      expect(result).toMatchObject({ postedAt: docDate, postedOnReceiveDate: false });
    });

    it('งวดของวันในเอกสารปิด → ลงวันที่รับของ (แบบ ข เหมือนใบรับของ) ไม่ใช่วันที่รับเข้าคลัง', async () => {
      const { tx, template, journal } = build({ locked: withDoc(), closed: ['2026-6'] });

      const result = await journal.bookIfPending(tx, 'prod-2', acceptedAt);

      expect(template.execute.mock.calls[0][0].postedAt).toBe(receivedAt);
      expect(result).toMatchObject({ postedAt: receivedAt, postedOnReceiveDate: true, postedOnAcceptanceDate: false });
      expect(tx.todo.create).toHaveBeenCalledTimes(1);
    });

    it('มีงานแจ้งฝ่ายบัญชีของใบรับของนี้ค้างอยู่แล้ว → ไม่สร้างซ้ำ', async () => {
      const { tx, journal } = build({ locked: withDoc(), closed: ['2026-6'] });
      tx.todo.findFirst.mockResolvedValue({ id: 'todo-1' });

      await journal.bookIfPending(tx, 'prod-2', acceptedAt);

      expect(tx.todo.create).not.toHaveBeenCalled();
    });

    it('ลงวันที่ในเอกสารได้ตามปกติ → ไม่มีงานแจ้งฝ่ายบัญชี', async () => {
      const { tx, journal } = build({ locked: withDoc() });
      await journal.bookIfPending(tx, 'prod-2', acceptedAt);
      expect(tx.todo.findFirst).not.toHaveBeenCalled();
      expect(tx.todo.create).not.toHaveBeenCalled();
    });

    it('งวดของวันในเอกสารและวันรับของปิดทั้งคู่ → ลงวันที่รับเข้าคลัง', async () => {
      const { tx, template, journal } = build({ locked: withDoc(), closed: ['2026-6', '2026-7'] });

      const result = await journal.bookIfPending(tx, 'prod-2', acceptedAt);

      expect(template.execute.mock.calls[0][0].postedAt).toBe(acceptedAt);
      expect(result).toMatchObject({ postedAt: acceptedAt, postedOnReceiveDate: false, postedOnAcceptanceDate: true });
    });
  });

  it('งวดบัญชีของวันรับของปิดไปแล้ว (รอถ่ายรูปข้ามเดือน) → ลงวันที่รับเข้าคลังแทน ไม่ปฏิเสธการเข้าคลัง', async () => {
    const { tx, template, journal } = build({ closed: ['2026-7'] });

    const result = await journal.bookIfPending(tx, 'prod-2', acceptedAt);

    expect(template.execute.mock.calls[0][0].postedAt).toBe(acceptedAt);
    expect(template.execute.mock.calls[0][0].postedOnAcceptanceDate).toBe(true); // ฝ่ายบัญชีเห็นใน metadata
    expect(result).toMatchObject({ postedAt: acceptedAt, postedOnAcceptanceDate: true });
    // แจ้งฝ่ายบัญชีในธุรกรรมเดียวกัน — ผู้สร้าง = ผู้รับของ
    // แท็กกันซ้ำแยกตาม (ใบรับของ, วันที่ที่ลงแทน) — ไม่ค้นจากชื่องาน · ชื่องานบอกเดือนที่ปิดจริง (เดือนของวันที่รับของ)
    expect(tx.todo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tags: { hasEvery: ['goods-receiving-period', 'gr:GR-2026-09-001:acceptance'] } }),
      }),
    );
    expect(tx.todo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tags: ['goods-receiving-period', 'gr:GR-2026-09-001:acceptance'],
        createdById: 'user-1',
        title: 'รับสินค้า GR-2026-09-001 เครื่องที่เข้าคลังทีหลังลงบัญชีวันที่รับเข้าคลังแทน (งวดกรกฎาคม 2569ปิดแล้ว)',
      }),
    });
  });

  it('งวดของวันรับของปิดแต่ยังอยู่ในช่วงผ่อนผัน → ไม่ลงย้อนกลับเข้าเดือนที่ปิด ลงวันที่รับเข้าคลังแทน (ผลตรวจทานรอบ 5)', async () => {
    const { tx, template, journal } = build({ closed: ['2026-7'] });
    // ช่วงผ่อนผันยาวมาก: validatePeriodOpen ปล่อยให้ลงเข้ากรกฎาคมที่ปิดแล้ว — วันที่ลงย้อนหลังต้องไม่ใช้ช่องนี้
    tx.systemConfig.findUnique.mockResolvedValue({ value: '99999' });

    const result = await journal.bookIfPending(tx, 'prod-2', acceptedAt);

    expect(template.execute.mock.calls[0][0].postedAt).toBe(acceptedAt);
    expect(result).toMatchObject({ postedOnAcceptanceDate: true });
  });

  it('งวดของวันรับเข้าคลังก็ปิด → ปฏิเสธด้วยข้อความงวดบัญชีตามปกติ (ไม่ลงเงียบ ๆ)', async () => {
    const { tx, template, journal } = build({ closed: ['2026-7', '2026-8'] });

    await expect(journal.bookIfPending(tx, 'prod-2', acceptedAt)).rejects.toThrow(/งวดที่ปิดแล้ว/);
    expect(template.execute).not.toHaveBeenCalled();
    expect(tx.goodsReceivingItem.update).not.toHaveBeenCalled();
  });

  it.each([
    ['ไม่ได้มาจากใบรับของ (รับซื้อมือสอง / ยึดเครื่อง)', { item: null }],
    ['รับก่อนระบบลงบัญชีรับของ (ไม่มีต้นทุนที่ปันไว้ — ไม่ลงย้อนหลัง)', { item: { id: 'gri-1', receivedCost: null, journalEntryId: null } }],
    ['ลงไปแล้ว (ตอนรับของ หรือเคยผ่านเข้าคลังแล้ว)', { item: { id: 'gri-1', receivedCost: D('4199.66'), journalEntryId: 'je-1' } }],
    ['อีกคำขอลงไปก่อนระหว่างรอล็อก', { locked: receivingRow({ journalEntryId: 'je-other' }) }],
  ])('ไม่ทำอะไรเมื่อ%s', async (_label, opts) => {
    const { tx, template, journal } = build(opts as never);

    await expect(journal.bookIfPending(tx, 'prod-2', acceptedAt)).resolves.toBeNull();
    expect(template.execute).not.toHaveBeenCalled();
    expect(tx.goodsReceivingItem.update).not.toHaveBeenCalled();
  });

  it('ต้นทุนศูนย์ (ของแถมจากผู้จัดจำหน่าย) → ตัวลงบัญชีไม่โพสต์ และไม่ผูกแถว', async () => {
    const { tx, template, journal } = build();
    template.execute.mockResolvedValueOnce(null);

    await expect(journal.bookIfPending(tx, 'prod-2', acceptedAt)).resolves.toBeNull();
    expect(tx.goodsReceivingItem.update).not.toHaveBeenCalled();
  });

  it('บัญชีเจ้าหนี้ตามหมวดในใบสั่งซื้อ · บัญชีสินค้าตามหมวดปัจจุบันของเครื่อง (แก้หมวดระหว่างรอถ่ายรูป)', async () => {
    const { tx, template, journal } = build({
      locked: receivingRow({
        poItem: { category: 'ACCESSORY' },
        product: { category: 'PHONE_USED', status: 'IN_STOCK', deletedAt: null },
      }),
    });

    await journal.bookIfPending(tx, 'prod-2', acceptedAt);

    expect(template.execute.mock.calls[0][0].units).toEqual([
      { productId: 'prod-2', inventoryAccountCode: 'S11-2002', payableAccountCode: 'S21-1102', cost: D('4199.66') },
    ]);
  });

  // ผลตรวจทานอิสระ 2026-09-30: กด "ไม่รับเข้าคลัง" ชนกับกดยืนยันรูป — การตีกลับ commit ก่อน แล้วผู้เรียก
  // update สถานะทับเครื่องที่ถูกลบไปแล้ว ⇒ ต้องปฏิเสธทั้งรายการ ไม่ลงสินค้าที่ไม่ได้รับเข้าคลัง
  it.each([
    ['ถูกตีกลับ (ลบ) ไปแล้ว', { category: 'PHONE_USED', status: 'IN_STOCK', deletedAt: new Date() }],
    ['สถานะไม่ใช่ IN_STOCK', { category: 'PHONE_USED', status: 'PHOTO_PENDING', deletedAt: null }],
  ])('เครื่อง%s หลังล็อกแถว → ปฏิเสธ ไม่ลงบัญชี', async (_label, product) => {
    const { tx, template, journal } = build({ locked: receivingRow({ product }) });

    await expect(journal.bookIfPending(tx, 'prod-2', acceptedAt)).rejects.toThrow(ConflictException);
    expect(template.execute).not.toHaveBeenCalled();
    expect(tx.goodsReceivingItem.update).not.toHaveBeenCalled();
  });
});

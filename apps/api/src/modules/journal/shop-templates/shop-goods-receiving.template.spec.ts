import { Prisma } from '@prisma/client';
import { ShopGoodsReceivingTemplate, ShopGoodsReceivingInput } from '../cpa-templates/shop-goods-receiving.template';
import {
  makeMockJournalAuto,
  makeMockPrisma,
  makeMockCompanyResolver,
  seedExistingJournalEntry,
} from './test-helpers';

/**
 * รับสินค้าเข้าจากใบสั่งซื้อ — คำตอบฝ่ายบัญชี 2026-09-29 ข้อ ข1:
 *   Dr สินค้าคงคลัง (ตามประเภท) / Cr เจ้าหนี้ผู้จัดจำหน่าย (มือถือ S21-1101 · อุปกรณ์เสริม S21-1102)
 */
describe('ShopGoodsReceivingTemplate (unit)', () => {
  const D = (v: string | number) => new Prisma.Decimal(v);

  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    const template = new ShopGoodsReceivingTemplate(journal.service, prisma.prisma, resolver);
    return { template, journal, prisma, resolver };
  }

  const input = (over: Partial<ShopGoodsReceivingInput> = {}): ShopGoodsReceivingInput => ({
    idempotencyKey: 'shop-goods-receiving:gr-1',
    receivingId: 'gr-1',
    grNumber: 'GR-2026-09-001',
    poId: 'po-1',
    poNumber: 'PO-2026-09-001',
    units: [{ inventoryAccountCode: 'S11-2001', payableAccountCode: 'S21-1101', cost: D('10700') }],
    ...over,
  });

  const line = (lines: { accountCode: string }[], code: string) => lines.find((l) => l.accountCode === code)!;

  it('ข1 — มือถือใหม่ 1 เครื่อง ต้นทุน 10,700: Dr S11-2001 / Cr S21-1101', async () => {
    const { template, journal } = build();
    const result = await template.execute(input());

    const lines = journal.state.lastInput!.lines;
    expect(lines).toHaveLength(2);
    expect(line(lines, 'S11-2001')).toMatchObject({ accountCode: 'S11-2001' });
    expect(lines[0].dr.toFixed(2)).toBe('10700.00');
    expect(lines[0].cr.toFixed(2)).toBe('0.00');
    expect(lines[1].accountCode).toBe('S21-1101');
    expect(lines[1].cr.toFixed(2)).toBe('10700.00');
    expect(result).toEqual({ entryNo: 'JE-je-1', journalEntryId: 'je-1' });
  });

  it('ใบผสม — รวมยอดต่อบัญชี: เดบิตเรียงรหัสก่อน แล้วเครดิตเรียงรหัส', async () => {
    const { template, journal } = build();
    await template.execute(
      input({
        units: [
          { inventoryAccountCode: 'S11-2003', payableAccountCode: 'S21-1102', cost: D('535') },
          { inventoryAccountCode: 'S11-2001', payableAccountCode: 'S21-1101', cost: D('26750') },
          { inventoryAccountCode: 'S11-2002', payableAccountCode: 'S21-1101', cost: D('8000') },
          { inventoryAccountCode: 'S11-2001', payableAccountCode: 'S21-1101', cost: D('26750') },
          { inventoryAccountCode: 'S11-2003', payableAccountCode: 'S21-1102', cost: D('535') },
        ],
      }),
    );

    const lines = journal.state.lastInput!.lines;
    expect(lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['S11-2001', '53500.00', '0.00'],
      ['S11-2002', '8000.00', '0.00'],
      ['S11-2003', '1070.00', '0.00'],
      ['S21-1101', '0.00', '61500.00'],
      ['S21-1102', '0.00', '1070.00'],
    ]);
  });

  it('โพสต์ใต้บริษัท SHOP พร้อม metadata ที่ตามกลับไปหาใบรับของได้ และไม่มี contractId/saleId', async () => {
    const { template, journal } = build();
    const postedAt = new Date('2026-09-29T03:00:00.000Z');
    await template.execute(input({ postedAt }));

    const posted = journal.state.lastInput! as unknown as {
      companyId: string;
      description: string;
      reference: string;
      postedAt: Date;
      metadata: Record<string, unknown>;
    };
    expect(posted.companyId).toBe('shop-co-id');
    expect(posted.reference).toBe('gr:gr-1');
    expect(posted.postedAt).toBe(postedAt);
    expect(posted.description).toBe('รับสินค้าเข้า GR-2026-09-001 ใบสั่งซื้อ PO-2026-09-001 (SHOP)');
    expect(posted.metadata).toEqual({
      tag: 'SHOP_GOODS_RECEIVING',
      flow: 'shop-goods-receiving',
      idempotencyKey: 'shop-goods-receiving:gr-1',
      receivingId: 'gr-1',
      grNumber: 'GR-2026-09-001',
      poId: 'po-1',
      poNumber: 'PO-2026-09-001',
      companyCode: 'SHOP',
      unitCount: 1,
      totalCost: '10700.00',
    });
  });

  it('หน่วยที่ต้นทุนศูนย์ไม่สร้างบรรทัด · ทั้งใบเป็นศูนย์ = ไม่โพสต์ คืน null', async () => {
    const { template, journal } = build();
    await template.execute(
      input({
        units: [
          { inventoryAccountCode: 'S11-2001', payableAccountCode: 'S21-1101', cost: D('10700') },
          { inventoryAccountCode: 'S11-2003', payableAccountCode: 'S21-1102', cost: D('0') },
        ],
      }),
    );
    expect(journal.state.lastInput!.lines.map((l) => l.accountCode)).toEqual(['S11-2001', 'S21-1101']);

    const empty = build();
    const result = await empty.template.execute(
      input({ units: [{ inventoryAccountCode: 'S11-2003', payableAccountCode: 'S21-1102', cost: D('0') }] }),
    );
    expect(result).toBeNull();
    expect(empty.journal.state.callCount).toBe(0);
  });

  it('ไม่มีหน่วยเลย = ไม่โพสต์ คืน null', async () => {
    const { template, journal } = build();
    await expect(template.execute(input({ units: [] }))).resolves.toBeNull();
    expect(journal.state.callCount).toBe(0);
  });

  it('ปฏิเสธบัญชีสินค้าที่ไม่ใช่สินค้าคงคลังของร้าน', async () => {
    const { template } = build();
    await expect(
      template.execute(input({ units: [{ inventoryAccountCode: '11-3101', payableAccountCode: 'S21-1101', cost: D('100') }] })),
    ).rejects.toThrow(/inventoryAccountCode/);
    await expect(
      template.execute(input({ units: [{ inventoryAccountCode: 'S11-2004', payableAccountCode: 'S21-1101', cost: D('100') }] })),
    ).rejects.toThrow(/inventoryAccountCode/);
  });

  it('ปฏิเสธบัญชีเจ้าหนี้ที่ไม่ใช่เจ้าหนี้ผู้จัดจำหน่าย (รวมบัญชีที่เลนส์ระหว่างกิจการอ่าน)', async () => {
    const { template } = build();
    await expect(
      template.execute(input({ units: [{ inventoryAccountCode: 'S11-2001', payableAccountCode: 'S21-1104', cost: D('100') }] })),
    ).rejects.toThrow(/payableAccountCode/);
    await expect(
      template.execute(input({ units: [{ inventoryAccountCode: 'S11-2001', payableAccountCode: '21-1101', cost: D('100') }] })),
    ).rejects.toThrow(/payableAccountCode/);
  });

  it('ปฏิเสธต้นทุนติดลบ', async () => {
    const { template, journal } = build();
    await expect(
      template.execute(input({ units: [{ inventoryAccountCode: 'S11-2001', payableAccountCode: 'S21-1101', cost: D('-1') }] })),
    ).rejects.toThrow(/cost/);
    expect(journal.state.callCount).toBe(0);
  });

  it('idempotent — ใบรับของเดิมไม่ถูกโพสต์ซ้ำ', async () => {
    const { template, prisma, journal } = build();
    seedExistingJournalEntry(prisma.state, 'shop-goods-receiving', 'shop-goods-receiving:gr-1', 'existing', 'JE-X');
    const result = await template.execute(input());
    expect(result).toEqual({ entryNo: 'JE-X', journalEntryId: 'existing' });
    expect(journal.state.callCount).toBe(0);
  });

  it('ใช้ transaction ของผู้เรียกเมื่อส่งมา ไม่เปิดใหม่', async () => {
    const { template, prisma } = build();
    await template.execute(input(), prisma.prisma);
    expect(prisma.prisma.$transaction).not.toHaveBeenCalled();
  });
});

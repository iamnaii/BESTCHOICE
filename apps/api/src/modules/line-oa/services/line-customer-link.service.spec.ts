import { LineCustomerLinkService } from './line-customer-link.service';
import { LineOaService } from '../line-oa.service';

describe('LineCustomerLinkService.selfLinkByPhone → ดูดผู้สนใจอัตโนมัติของห้อง LINE ร้าน', () => {
  it('ผูกสำเร็จ → absorbRoomsOfLineUser(lineUserId, LINE_SHOP, customerId, SYSTEM)', async () => {
    const prisma: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'cust-real', name: 'สมชาย' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const merge = { absorbRoomsOfLineUser: jest.fn().mockResolvedValue({ absorbed: 1, linked: 0 }) };
    const service = new LineCustomerLinkService(prisma, {} as any, merge as any);
    await expect(service.selfLinkByPhone('Uabc', '0812345678')).resolves.toEqual({ success: true, customerName: 'สมชาย' });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-real' },
      data: { lineIdShop: 'Uabc' },
    });
    expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith('Uabc', 'LINE_SHOP', 'cust-real', { id: 'system', role: 'SYSTEM' });
  });

  it('ไม่พบเบอร์ → ไม่เรียก absorb', async () => {
    const prisma: any = { customer: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } };
    const merge = { absorbRoomsOfLineUser: jest.fn() };
    const service = new LineCustomerLinkService(prisma, {} as any, merge as any);
    await expect(service.selfLinkByPhone('Uabc', '0812345678')).resolves.toEqual({ success: false });
    expect(merge.absorbRoomsOfLineUser).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('absorbRoomsOfLineUser ล้ม (เช่น placeholder มีเอกสารพ่วง) → ยังคืนผลผูกสำเร็จ (best-effort — เบอร์ผูกไปแล้วจริง)', async () => {
    const prisma: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'cust-real', name: 'สมชาย' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const merge = { absorbRoomsOfLineUser: jest.fn().mockRejectedValue(new Error('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ')) };
    const service = new LineCustomerLinkService(prisma, {} as any, merge as any);
    await expect(service.selfLinkByPhone('Uabc', '0812345678')).resolves.toEqual({ success: true, customerName: 'สมชาย' });
    expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith('Uabc', 'LINE_SHOP', 'cust-real', { id: 'system', role: 'SYSTEM' });
  });

  it('LINE นี้ผูกไว้แล้ว (ผูกซ้ำ) → คืนผลเดิม ไม่เรียก absorb (ไม่มีห้องใหม่ให้ดูด — ChatProspectService หา lineIdShop ก่อนสร้าง placeholder เสมอ)', async () => {
    const prisma: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cust-real', name: 'สมชาย' }),
        update: jest.fn(),
      },
    };
    const merge = { absorbRoomsOfLineUser: jest.fn() };
    const service = new LineCustomerLinkService(prisma, {} as any, merge as any);
    await expect(service.selfLinkByPhone('Uabc', '0812345678')).resolves.toEqual({ success: true, customerName: 'สมชาย' });
    expect(merge.absorbRoomsOfLineUser).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});

describe('LineCustomerLinkService.selfLinkByPhone → LINE_LINKED (LINE ร้าน)', () => {
  function linkingPrisma(): any {
    return {
      customer: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'cust-real', name: 'สมชาย' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
  }

  it('ผูกสำเร็จ → LINE_LINKED {SHOP, SELF_LINK_PHONE} หลัง update · ไม่มีเบอร์และ LINE user id ในแถว', async () => {
    const prisma = linkingPrisma();
    const order: string[] = [];
    prisma.customer.update.mockImplementation(async () => {
      order.push('update');
      return {};
    });
    const journey = {
      recordAfterCommit: jest.fn().mockImplementation(async () => {
        order.push('journey');
      }),
    };
    const service = new LineCustomerLinkService(prisma, {} as any, undefined, journey as any);
    await expect(service.selfLinkByPhone('Uabc', '0812345678')).resolves.toEqual({ success: true, customerName: 'สมชาย' });
    expect(order).toEqual(['update', 'journey']);
    const entry = journey.recordAfterCommit.mock.calls[0][0];
    expect(entry).toMatchObject({
      customerId: 'cust-real',
      kind: 'LINE_LINKED',
      actorType: 'CUSTOMER',
      actorUserId: null,
      data: { channel: 'SHOP', via: 'SELF_LINK_PHONE' },
    });
    expect(entry.dedupeKey).toBe(`LINE_LINKED:SHOP:cust-real:${entry.occurredAt.getTime()}`);
    const json = JSON.stringify(entry);
    expect(json).not.toContain('0812345678');
    expect(json).not.toContain('Uabc');
  });

  it('absorb ล้ม → ยังบันทึก LINE_LINKED (ผูกสำเร็จจริง)', async () => {
    const prisma = linkingPrisma();
    const merge = { absorbRoomsOfLineUser: jest.fn().mockRejectedValue(new Error('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ')) };
    const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const service = new LineCustomerLinkService(prisma, {} as any, merge as any, journey as any);
    await service.selfLinkByPhone('Uabc', '0812345678');
    expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('ไม่พบเบอร์ หรือ LINE นี้ผูกไว้แล้ว → ไม่บันทึก', async () => {
    const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const notFound: any = { customer: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } };
    await new LineCustomerLinkService(notFound, {} as any, undefined, journey as any).selfLinkByPhone('Uabc', '0812345678');
    const already: any = { customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-real', name: 'สมชาย' }), update: jest.fn() } };
    await new LineCustomerLinkService(already, {} as any, undefined, journey as any).selfLinkByPhone('Uabc', '0812345678');
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('LineOaService ส่ง writer ต่อให้ LineCustomerLinkService (ตัวที่ถูก new เอง ไม่ผ่าน Nest DI)', async () => {
    const prisma = linkingPrisma();
    const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const facade = new LineOaService({} as any, prisma, {} as any, {} as any, undefined, journey as any);
    await facade.selfLinkByPhone('Uabc', '0812345678');
    expect(journey.recordAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'LINE_LINKED', customerId: 'cust-real' }),
    );
  });
});

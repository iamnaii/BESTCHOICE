import { LineCustomerLinkService } from './line-customer-link.service';

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

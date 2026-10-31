import { ChatChannel } from '@prisma/client';
import { RoomManagerService } from './room-manager.service';

/**
 * Task 24 fix round 1 M-2 — ห้อง LINE การเงินที่ chat-engine สร้างใหม่ได้ลูกค้า + `verified_at` จากแถว link ตามเกณฑ์เดียว
 * `VERIFIED_FINANCE_LINK_WHERE` (แถวที่ยังผูกของลูกค้าที่ยังอยู่) — สมมาตรกับ `unlinkFinanceLine` ที่ล้าง verified_at ·
 * ช่อง SHOP ยังรับแถวทุกสถานะ (TODO พร้อมงาน OA ร้าน — วันนี้ไม่มีผู้เขียนแถวช่อง SHOP)
 */
describe('RoomManagerService.getOrCreateRoom — แถว link ที่ใช้สร้างห้องใหม่', () => {
  const build = (link: unknown) => {
    const prisma = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'room-1',
          ...data,
        })),
      },
      customerLineLink: { findUnique: jest.fn().mockResolvedValue(link) },
    };
    return { prisma, service: new RoomManagerService(prisma as never, {} as never) };
  };

  it('LINE การเงิน: ค้นแถวด้วยเกณฑ์เดียว VERIFIED_FINANCE_LINK_WHERE · ไม่พบ = ห้องไม่มีลูกค้า ไม่ verified', async () => {
    const { prisma, service } = build(null);
    await service.getOrCreateRoom({ externalUserId: 'U-old', channel: ChatChannel.LINE_FINANCE });
    expect(prisma.customerLineLink.findUnique).toHaveBeenCalledWith({
      where: {
        lineUserId_channel: { lineUserId: 'U-old', channel: 'FINANCE' },
        channel: 'FINANCE',
        unlinkedAt: null,
        deletedAt: null,
        customer: { deletedAt: null },
      },
    });
    expect(prisma.chatRoom.create.mock.calls[0][0].data).toMatchObject({
      customerId: undefined,
      verifiedAt: null,
    });
  });

  it('LINE การเงิน: พบแถว → ห้องของลูกค้านั้น verified', async () => {
    const { prisma, service } = build({ customerId: 'cust-1' });
    await service.getOrCreateRoom({ externalUserId: 'U-1', channel: ChatChannel.LINE_FINANCE });
    expect(prisma.chatRoom.create.mock.calls[0][0].data).toMatchObject({
      customerId: 'cust-1',
      verifiedAt: expect.any(Date),
    });
  });

  it('LINE ร้าน: คงพฤติกรรมเดิม (ค้นตาม unique key อย่างเดียว — TODO พร้อม OTP ฝั่งร้าน)', async () => {
    const { prisma, service } = build({ customerId: 'cust-shop' });
    await service.getOrCreateRoom({ externalUserId: 'U-shop', channel: ChatChannel.LINE_SHOP });
    expect(prisma.customerLineLink.findUnique).toHaveBeenCalledWith({
      where: { lineUserId_channel: { lineUserId: 'U-shop', channel: 'SHOP' } },
    });
  });
});

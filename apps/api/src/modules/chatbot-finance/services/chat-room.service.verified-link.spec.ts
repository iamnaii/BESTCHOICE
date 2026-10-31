import { ChatChannel } from '@prisma/client';
import { ChatRoomService } from './chat-room.service';

/**
 * Task 24 M-8 (ฝั่งตั้งค่า — ให้สมมาตรกับยกเลิกผูก) — ห้อง LINE การเงินที่สร้างใหม่ได้ลูกค้า + `verified_at` จากแถว link
 * **ที่ยังผูก** เท่านั้น (เกณฑ์เดียวกับ `isLinked` / `findExistingCustomerId`) · แถวที่ยกเลิก/ลบแล้ว = ห้องผู้สนใจ ไม่ verified
 * (เดิม `findUnique` รับแถวทุกสถานะ ⇒ LINE ที่ยกเลิกผูกแล้วทักครั้งแรกได้ห้อง verified ของลูกค้าเดิม — แม่แบบ verifiedOnly ส่งได้) ·
 * พฤติกรรมบน Postgres จริงอยู่ที่ `line-oa/services/finance-room-verification.db.spec.ts` ข้อ 5–6
 */
describe('ChatRoomService.getOrCreate — verified_at จากแถว link ที่ยังผูกเท่านั้น', () => {
  const build = (link: unknown) => {
    const prisma = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'room-fin',
          channel: ChatChannel.LINE_FINANCE,
          ...data,
        })),
      },
      customerLineLink: { findUnique: jest.fn().mockResolvedValue(link) },
    };
    const prospects = {
      ensureForRoom: jest.fn().mockResolvedValue({ customerId: 'prospect', created: true }),
    };
    const service = new ChatRoomService(
      prisma as never,
      { getUserProfile: jest.fn().mockResolvedValue(null) } as never,
      undefined,
      prospects as never,
    );
    return { prisma, prospects, service };
  };

  it('ค้นแถวด้วยเกณฑ์เดียว VERIFIED_FINANCE_LINK_WHERE · ไม่พบ (ยกเลิก/ลบแล้ว หรือลูกค้าถูกลบ) → ห้องไม่มีลูกค้า ไม่ verified (เป็นผู้สนใจ)', async () => {
    const { prisma, prospects, service } = build(null);
    await service.getOrCreate('U-old');
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
    expect(prospects.ensureForRoom).toHaveBeenCalledWith('room-fin');
  });

  it('แถว link ที่ยังผูก → ห้องของลูกค้านั้น verified', async () => {
    const { prisma, prospects, service } = build({
      customerId: 'cust-1',
      unlinkedAt: null,
      deletedAt: null,
    });
    await service.getOrCreate('U-1');
    expect(prisma.chatRoom.create.mock.calls[0][0].data).toMatchObject({
      customerId: 'cust-1',
      verifiedAt: expect.any(Date),
    });
    expect(prospects.ensureForRoom).not.toHaveBeenCalled();
  });
});

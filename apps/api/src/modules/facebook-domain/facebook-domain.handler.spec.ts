import { ChatChannel, MessageType } from '@prisma/client';
import { FacebookDomainHandler } from './facebook-domain.handler';
import { FacebookQuickReplyService } from './facebook-quick-reply.service';

describe('FacebookDomainHandler — ห้องที่พนักงานรับไปแล้ว (C01, 2026-09-22)', () => {
  const make = (fbBotDisabled?: string) =>
    new FacebookDomainHandler(new FacebookQuickReplyService(), {
      get: (key: string) => (key === 'FB_BOT_DISABLED' ? fbBotDisabled : undefined),
    } as any);
  const ctx = (room: Record<string, unknown>, message: Record<string, unknown>) =>
    ({
      room: { id: 'r1', aiPaused: false, handoffMode: false, ...room },
      message: {
        externalUserId: 'PSID-1',
        channel: ChatChannel.FACEBOOK,
        type: MessageType.TEXT,
        ...message,
      },
      isVerified: !!room.verifiedAt,
      isHandoff: !!room.handoffMode,
    }) as any;

  it('aiPaused + ยังไม่ยืนยันตัวตน → ไม่ส่งข้อความใด ๆ (ไม่แทรก "รบกวนยืนยันตัวตน")', async () => {
    const res = await make().handleMessage(
      ctx({ aiPaused: true, verifiedAt: null }, { text: 'ขอบคุณค่ะ' }),
    );
    expect(res.replies).toEqual([]);
    expect(res.shouldHandoff).toBeFalsy();
  });

  it('aiPaused + ยืนยันตัวตนแล้ว + ส่งรูป → ยังได้ข้อความตอบรับสลิป', async () => {
    const res = await make().handleMessage(
      ctx(
        { aiPaused: true, verifiedAt: new Date('2026-09-01T00:00:00Z') },
        { type: MessageType.IMAGE, mediaUrl: 'https://example.com/slip.jpg' },
      ),
    );
    expect(res.replies).toHaveLength(1);
    expect(res.replies[0].text).toContain('ได้รับสลิปแล้วค่ะ');
    expect(res.tags).toEqual(['slip']);
  });

  it('ไม่ได้ aiPaused + ยังไม่ยืนยันตัวตน → พฤติกรรมเดิม (ข้อความยืนยันตัวตน)', async () => {
    const res = await make().handleMessage(
      ctx({ aiPaused: false, verifiedAt: null }, { text: 'สวัสดีค่ะ' }),
    );
    expect(res.replies[0].text).toContain('รบกวนยืนยันตัวตน');
  });

  it('FB_BOT_DISABLED / handoff → เงียบเหมือนเดิม', async () => {
    expect(
      (await make('true').handleMessage(ctx({ verifiedAt: null }, { text: 'hi' }))).replies,
    ).toEqual([]);
    expect(
      (await make().handleMessage(ctx({ handoffMode: true, verifiedAt: null }, { text: 'hi' })))
        .replies,
    ).toEqual([]);
  });
});

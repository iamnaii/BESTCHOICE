import { PrismaClient, ChatChannel, MessageRole, MessageType } from '@prisma/client';
import { RoomManagerService } from './room-manager.service';

/**
 * DB-backed regression spec for the WS1 legacy-draft filter (#d0fe76bed).
 *
 * The mock-based spec pinned the *shape* of the where clause and missed the
 * SQL semantics: `NOT (intent LIKE 'DRAFT:%' AND delivered_at IS NULL)` is
 * NULL (not TRUE) for rows where intent IS NULL — which is every customer and
 * staff message — so Postgres dropped them all and the inbox rendered empty.
 * This spec runs the real query against Postgres so three-valued-logic
 * regressions cannot slip through a mock again.
 */
describe('RoomManagerService.getRecentMessages (real DB)', () => {
  const prisma = new PrismaClient();
  let service: RoomManagerService;
  let roomId: string;

  beforeAll(async () => {
    service = new RoomManagerService(prisma as any, { configured: false } as any);

    const room = await prisma.chatRoom.create({
      data: {
        channel: ChatChannel.FACEBOOK,
        externalUserId: `recent-messages-spec-${Date.now()}`,
        displayName: 'recent-messages spec',
      },
    });
    roomId = room.id;

    await prisma.chatMessage.createMany({
      data: [
        // Normal traffic — intent is NULL on every customer/staff message.
        { roomId, role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'customer text' },
        { roomId, role: MessageRole.STAFF, type: MessageType.TEXT, text: 'staff text' },
        // Bot reply with an intent.
        { roomId, role: MessageRole.BOT, type: MessageType.TEXT, text: 'bot auto', intent: 'AUTO:sales' },
        // Legacy pipeline draft that never reached the customer — must stay hidden.
        { roomId, role: MessageRole.BOT, type: MessageType.TEXT, text: 'undelivered draft', intent: 'DRAFT:sales' },
        // Draft that WAS delivered — part of the conversation, must stay visible.
        {
          roomId,
          role: MessageRole.BOT,
          type: MessageType.TEXT,
          text: 'delivered draft',
          intent: 'DRAFT:sales',
          deliveredAt: new Date(),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { roomId } });
    await prisma.chatRoom.delete({ where: { id: roomId } });
    await prisma.$disconnect();
  });

  it('returns customer and staff messages (NULL intent) and hides only undelivered drafts', async () => {
    const messages = await service.getRecentMessages(roomId, 50);
    const texts = messages.map((m: { text: string | null }) => m.text);

    expect(texts).toContain('customer text');
    expect(texts).toContain('staff text');
    expect(texts).toContain('bot auto');
    expect(texts).toContain('delivered draft');
    expect(texts).not.toContain('undelivered draft');
  });
});

import { Test } from '@nestjs/testing';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { PrismaService } from '../../prisma/prisma.service';

async function build(prisma: any) {
  const mod = await Test.createTestingModule({
    providers: [ChatAiDraftService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(ChatAiDraftService);
}

describe('ChatAiDraftService', () => {
  it('takeOver pauses AI and assigns room to staff', async () => {
    const prisma = {
      chatRoom: { update: jest.fn().mockResolvedValue({}) },
    };
    const svc = await build(prisma);
    const result = await svc.takeOver('r1', 'staff1');
    expect(result.paused).toBe(true);
    expect(prisma.chatRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          aiPaused: true,
          aiPausedById: 'staff1',
          assignedToId: 'staff1',
        }),
      }),
    );
  });

  describe('releaseToAi', () => {
    it('resets aiPaused flags + writes AI_RELEASED audit log in $transaction', async () => {
      const prisma: any = {
        chatRoom: { update: jest.fn().mockResolvedValue({ id: 'room-1' }) },
        auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
        $transaction: jest.fn((fn: any) => fn(prisma)),
      };
      const svc = await build(prisma);
      const result = await svc.releaseToAi('room-1', 'staff-1');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { aiPaused: false, aiPausedAt: null, aiPausedById: null },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'staff-1',
          action: 'AI_RELEASED',
          entity: 'chat_room',
          entityId: 'room-1',
        },
      });
      expect(result.released).toBe(true);
    });
  });
});

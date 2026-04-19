import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SideConversationService } from './side-conversation.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('SideConversationService', () => {
  let service: SideConversationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({ id: 'room-1' }),
      },
      chatSideMessage: {
        create: jest.fn((args) => Promise.resolve({ id: 'sm-1', ...args.data })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [SideConversationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(SideConversationService);
  });

  describe('addMessage', () => {
    it('creates a side message for an existing room', async () => {
      await service.addMessage('room-1', 'u-1', 'internal note');
      const data = prisma.chatSideMessage.create.mock.calls[0][0].data;
      expect(data.roomId).toBe('room-1');
      expect(data.staffId).toBe('u-1');
      expect(data.text).toBe('internal note');
    });

    it('throws NotFound when room missing', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue(null);
      await expect(
        service.addMessage('missing', 'u-1', 'note'),
      ).rejects.toThrow(NotFoundException);
    });

    it('includes staff info in response', async () => {
      await service.addMessage('room-1', 'u-1', 'note');
      const include = prisma.chatSideMessage.create.mock.calls[0][0].include;
      expect(include.staff.select).toEqual({ id: true, name: true, role: true });
    });
  });

  describe('getMessages', () => {
    it('filters by roomId + deletedAt null, ordered asc', async () => {
      await service.getMessages('room-1');
      const args = prisma.chatSideMessage.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ roomId: 'room-1', deletedAt: null });
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });
  });

  describe('deleteMessage (soft)', () => {
    it('sets deletedAt on existing non-deleted message', async () => {
      prisma.chatSideMessage.findUnique.mockResolvedValue({ id: 'sm-1', deletedAt: null });
      await service.deleteMessage('sm-1');
      const data = prisma.chatSideMessage.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('throws NotFound when message missing', async () => {
      prisma.chatSideMessage.findUnique.mockResolvedValue(null);
      await expect(service.deleteMessage('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound when message already soft-deleted', async () => {
      prisma.chatSideMessage.findUnique.mockResolvedValue({
        id: 'sm-1',
        deletedAt: new Date(),
      });
      await expect(service.deleteMessage('sm-1')).rejects.toThrow(NotFoundException);
    });
  });
});

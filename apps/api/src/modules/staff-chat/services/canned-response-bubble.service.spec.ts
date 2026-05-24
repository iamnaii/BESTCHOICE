import { Test } from '@nestjs/testing';
import { CannedResponseBubbleService } from './canned-response-bubble.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('CannedResponseBubbleService', () => {
  let service: CannedResponseBubbleService;
  let prisma: { cannedResponseBubble: any; $transaction: any };

  beforeEach(async () => {
    prisma = {
      cannedResponseBubble: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((arr) => Promise.all(arr)),
    };
    const module = await Test.createTestingModule({
      providers: [
        CannedResponseBubbleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CannedResponseBubbleService);
  });

  describe('createBubble', () => {
    it('creates TEXT bubble with sortOrder = current count', async () => {
      prisma.cannedResponseBubble.count.mockResolvedValue(2);
      prisma.cannedResponseBubble.create.mockResolvedValue({ id: 'b3', type: 'TEXT', sortOrder: 2 });
      const result = await service.createBubble('cr-1', { type: 'TEXT', text: 'hi' });
      expect(prisma.cannedResponseBubble.create).toHaveBeenCalledWith({
        data: { cannedResponseId: 'cr-1', type: 'TEXT', text: 'hi', mediaUrl: undefined, thumbnailUrl: undefined, stickerPackageId: undefined, stickerId: undefined, sortOrder: 2 },
      });
      expect(result.id).toBe('b3');
    });

    it('rejects when count >= 5', async () => {
      prisma.cannedResponseBubble.count.mockResolvedValue(5);
      await expect(service.createBubble('cr-1', { type: 'TEXT', text: 'hi' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('listBubbles', () => {
    it('returns bubbles sorted by sortOrder asc', async () => {
      prisma.cannedResponseBubble.findMany.mockResolvedValue([{ id: 'b1', sortOrder: 0 }]);
      await service.listBubbles('cr-1');
      expect(prisma.cannedResponseBubble.findMany).toHaveBeenCalledWith({
        where: { cannedResponseId: 'cr-1', deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('reorderBubbles', () => {
    it('rejects when > 5 items', async () => {
      const items = Array.from({ length: 6 }, (_, i) => ({ id: String(i), sortOrder: i }));
      await expect(service.reorderBubbles(items)).rejects.toThrow(BadRequestException);
    });
  });
});

import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CannedResponseQuickReplyService } from './canned-response-quickreply.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('CannedResponseQuickReplyService', () => {
  let service: CannedResponseQuickReplyService;
  let prisma: { cannedResponseQuickReply: any; $transaction: any };

  beforeEach(async () => {
    prisma = {
      cannedResponseQuickReply: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((arr) => Promise.all(arr)),
    };
    const module = await Test.createTestingModule({
      providers: [
        CannedResponseQuickReplyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CannedResponseQuickReplyService);
  });

  describe('create', () => {
    it('creates quick reply with sortOrder = current count when count < 13', async () => {
      prisma.cannedResponseQuickReply.count.mockResolvedValue(2);
      prisma.cannedResponseQuickReply.create.mockResolvedValue({
        id: 'qr3',
        label: 'ตกลง',
        type: 'POSTBACK',
        sortOrder: 2,
      });
      const result = await service.create('cr-1', {
        label: 'ตกลง',
        type: 'POSTBACK',
        payload: 'OK',
      });
      expect(prisma.cannedResponseQuickReply.create).toHaveBeenCalledWith({
        data: {
          cannedResponseId: 'cr-1',
          label: 'ตกลง',
          type: 'POSTBACK',
          payload: 'OK',
          sortOrder: 2,
        },
      });
      expect(result.id).toBe('qr3');
    });

    it('rejects when count >= 13', async () => {
      prisma.cannedResponseQuickReply.count.mockResolvedValue(13);
      await expect(
        service.create('cr-1', { label: 'x', type: 'MESSAGE', message: 'hi' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('returns quick replies sorted by sortOrder asc', async () => {
      prisma.cannedResponseQuickReply.findMany.mockResolvedValue([{ id: 'qr1', sortOrder: 0 }]);
      await service.list('cr-1');
      expect(prisma.cannedResponseQuickReply.findMany).toHaveBeenCalledWith({
        where: { cannedResponseId: 'cr-1', deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('update', () => {
    it('throws NotFoundException when quick reply missing', async () => {
      prisma.cannedResponseQuickReply.findFirst.mockResolvedValue(null);
      await expect(service.update('qr-missing', { label: 'new' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reorder', () => {
    it('rejects when > 13 items', async () => {
      const items = Array.from({ length: 14 }, (_, i) => ({ id: String(i), sortOrder: i }));
      await expect(service.reorder(items)).rejects.toThrow(BadRequestException);
    });
  });
});
